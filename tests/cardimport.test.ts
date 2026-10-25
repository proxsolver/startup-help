/**
 * 카드사 명세서 수입 로직 검사.
 *
 * 실제 신한카드 파일로 확인한 열 구성(거래일·카드구분·이용카드·가맹점명·업종·승인번호·금액·매입구분·
 * 이용구분·거래통화·최초결제일자·해외이용금액·취소상태)과 `총 1건` 합계 행을 **값만 바꿔서** 재현합니다.
 * 거래처명·승인번호는 지어낸 값입니다 — 명세서 원본 데이터는 공개 리포에 넣지 않습니다.
 *
 * .xlsx 는 파일로 보관하지 않고 검사 중에 zip 으로 조립합니다. 무압축(stored)과 deflate 두 갈래를
 * 다 지나가게 해서, DecompressionStream 경로가 실제로 작동하는지까지 확인합니다.
 */
import { describe, expect, it } from 'vitest';
import { crc32 as nodeCrc32, deflateRawSync } from 'node:zlib';
import {
  cardSettingsCompleteness,
  cardSettingsToOptions,
  decodeTable,
  detectColumns,
  emptyCardSettings,
  formatBudgetRuleLines,
  importCardFile,
  isAggregateRow,
  mapRows,
  MAX_CARD_TAILS,
  normalizeCardSettings,
  normalizeHeader,
  parseAmount,
  parseBudgetRuleLines,
  parseDate,
  parseDelimited,
  parseTails,
  readTableFile,
  readXlsx,
  rowIssue,
  rowsFromGrid,
  type CardField
} from '../src/lib/cardimport';
import { MAX_APPROVAL_CHARS, normalizeEntry } from '../src/lib/receipts';

/* ───────── 파일 대신 조립하는 zip ───────── */

function crc32(bytes: Uint8Array): number {
  let c = ~0;
  for (const b of bytes) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/** out 배열에 v 를 little-endian `bytes` 바이트로 붙입니다. */
function le(out: number[], v: number, bytes: number): void {
  for (let i = 0; i < bytes; i++) out.push((v >>> (8 * i)) & 0xff);
}

interface ZipItem {
  name: string;
  text: string;
  /** false 이면 무압축(stored) 항목으로 넣습니다. */
  deflate?: boolean;
}

function buildZip(items: ZipItem[]): Uint8Array {
  const enc = new TextEncoder();
  const local: number[] = [];
  const central: number[] = [];
  const record: { name: Uint8Array; method: number; crc: number; size: number; raw: number; at: number }[] = [];
  for (const item of items) {
    const raw = enc.encode(item.text);
    const deflated = item.deflate !== false;
    const data = deflated ? new Uint8Array(deflateRawSync(raw)) : raw;
    const name = enc.encode(item.name);
    record.push({ name, method: deflated ? 8 : 0, crc: crc32(raw), size: data.length, raw: raw.length, at: local.length });
    le(local, 0x04034b50, 4);
    le(local, 20, 2);
    le(local, 0, 2);
    le(local, deflated ? 8 : 0, 2);
    le(local, 0, 2);
    le(local, 0x0021, 2);
    le(local, record[record.length - 1].crc, 4);
    le(local, data.length, 4);
    le(local, raw.length, 4);
    le(local, name.length, 2);
    le(local, 0, 2);
    for (const b of name) local.push(b);
    for (const b of data) local.push(b);
  }
  for (const r of record) {
    le(central, 0x02014b50, 4);
    le(central, 20, 2);
    le(central, 20, 2);
    le(central, 0, 2);
    le(central, r.method, 2);
    le(central, 0, 2);
    le(central, 0x0021, 2);
    le(central, r.crc, 4);
    le(central, r.size, 4);
    le(central, r.raw, 4);
    le(central, r.name.length, 2);
    le(central, 0, 2);
    le(central, 0, 2);
    le(central, 0, 2);
    le(central, 0, 2);
    le(central, 0, 4);
    le(central, r.at, 4);
    for (const b of r.name) central.push(b);
  }
  const out: number[] = [];
  for (const b of local) out.push(b);
  const cdStart = out.length;
  for (const b of central) out.push(b);
  le(out, 0x06054b50, 4);
  le(out, 0, 2);
  le(out, 0, 2);
  le(out, record.length, 2);
  le(out, record.length, 2);
  le(out, out.length - cdStart, 4);
  le(out, cdStart, 4);
  le(out, 0, 2);
  return Uint8Array.from(out);
}

/** 신한카드 명세서와 같은 열 순서. 값은 지어낸 것입니다. */
const HEADERS = [
  '거래일', '카드구분', '이용카드', '가맹점명', '업종', '승인번호', '금액',
  '매입구분', '이용구분', '거래통화', '최초결제일자', '해외이용금액', '취소상태'
];

const ROWS: string[][] = [
  ['2026.10.05 09:14', '선불', '본인441*', '원단상사', '', '01234567', '158,000.0', '결제확정', '일시불', '', '', '', ''],
  ['2026.10.11 13:02', '후불', '본인902*', '택배대리점', '', '07654321', '18,500.0', '결제확정', '일시불', '', '', '', ''],
  ['', '', '', '총 2건', '', '', '176,500.0', '', '', '', '', '', '']
];

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** 문자열은 sharedStrings 로, 숫자는 값 그대로 심는 최소 OOXML 시트. */
function sheetXml(rows: (string | number)[][], mode: 'shared' | 'inline' = 'shared'): { sheet: string; shared: string[] } {
  const shared: string[] = [];
  const idx = new Map<string, number>();
  const put = (s: string): number => {
    const at = idx.get(s);
    if (at !== undefined) return at;
    idx.set(s, shared.length);
    shared.push(s);
    return shared.length - 1;
  };
  const ref = (r: number, c: number): string => `${String.fromCharCode(65 + c)}${r + 1}`;
  const lines = rows.map((row, r) => {
    const cells = row
      .map((v, c) => {
        if (v === '') return `<c r="${ref(r, c)}"/>`;
        if (typeof v === 'number') return `<c r="${ref(r, c)}"><v>${v}</v></c>`;
        if (mode === 'inline') return `<c r="${ref(r, c)}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
        return `<c r="${ref(r, c)}" t="s"><v>${put(v)}</v></c>`;
      })
      .join('');
    return `<row r="${r + 1}">${cells}</row>`;
  });
  return { sheet: `<?xml version="1.0"?><worksheet><sheetData>${lines.join('')}</sheetData></worksheet>`, shared };
}

function xlsxFile(
  rows: (string | number)[][],
  opt: { mode?: 'shared' | 'inline'; deflate?: boolean; rels?: boolean } = {}
): { name: string; arrayBuffer: () => Promise<ArrayBuffer> } {
  const { sheet, shared } = sheetXml(rows, opt.mode ?? 'shared');
  const ss = shared.length
    ? `<?xml version="1.0"?><sst count="${shared.length}">${shared.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>`
    : '';
  const items: ZipItem[] = [{ name: 'xl/worksheets/sheet1.xml', text: sheet, deflate: opt.deflate }];
  if (ss) items.push({ name: 'xl/sharedStrings.xml', text: ss, deflate: opt.deflate });
  if (opt.rels !== false)
    items.push({
      name: 'xl/_rels/workbook.xml.rels',
      text: '<?xml version="1.0"?><Relationships><Relationship Id="rId2" Type="http://x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      deflate: opt.deflate
    });
  items.push({ name: '[Content_Types].xml', text: '<?xml version="1.0"?><Types/>', deflate: opt.deflate });
  const bytes = buildZip(items);
  return { name: 'cardstatement_test.xlsx', arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer };
}

const textFile = (name: string, text: string) => ({
  name,
  arrayBuffer: async () => new TextEncoder().encode(text).slice().buffer as ArrayBuffer
});

/** '원단상사'·'한글' 을 EUC-KR 로 저장한 바이트 (ICU 디코더로 대조해 뽑은 값). */
const EUC_KR_BYTES = [
  0xbf, 0xf8, 0xb4, 0xdc, 0xbb, 0xf3, 0xbb, 0xe7,
  0x0a,
  0xc7, 0xd1, 0xb1, 0xdb
];

/* ───────── 조립기가 진짜 zip 을 만드는지 먼저 ───────── */

describe('검사용 zip 조립기', () => {
  it('체크섬 계산이 node 표준 값과 같다 (우리 해석기는 CRC 를 보지 않지만, 픽스처는 진짜 zip 이어야 합니다)', () => {
    const sample = new TextEncoder().encode('hello');
    expect(crc32(sample)).toBe(nodeCrc32(sample));
  });
});

/* ───────── 값 읽기 ───────── */

describe('날짜·금액 읽기', () => {
  it('명세서 표기 여럿을 YYYY-MM-DD 로 바꾼다', () => {
    expect(parseDate('2026.07.19 00:28')).toBe('2026-07-19');
    expect(parseDate('2026-10-05')).toBe('2026-10-05');
    expect(parseDate('2026/1/5')).toBe('2026-01-05');
    expect(parseDate('20260719')).toBe('2026-07-19');
    expect(parseDate('2026\u5E7407\u670819\u65E5')).toBe('2026-07-19'); // 연월일 구두점은 \u 로 적습니다(게이트가 리터럴을 막음)
  });

  it('엑셀 순증수와 1900 역법 보정을 처리한다', () => {
    // 날짜 서식 셀이 숫자로 나오는 경우(1899-12-30 기산)에 대비합니다.
    expect(parseDate('46000')).toBe('2025-12-09');
    expect(parseDate('45292')).toBe('2024-01-01');
  });

  it('읽을 수 없는 값은 빈 문자열로 돌려 나중에 걸러지게 한다', () => {
    expect(parseDate('')).toBe('');
    expect(parseDate('가맹점명')).toBe('');
    expect(parseDate('99-9')).toBe('');
  });

  it('통화기호·천단위·소수점을 정리해 정수 원으로 만든다', () => {
    expect(parseAmount('48,500.0')).toBe(48500);
    expect(parseAmount('₩48,500')).toBe(48500);
    expect(parseAmount('158000')).toBe(158000);
    expect(parseAmount('-1,000')).toBe(-1000);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('삼만원')).toBeNull();
  });
});

/* ───────── 열 매핑 ───────── */

describe('열 이름 매핑', () => {
  it('신한카드 열 열세 개를 모두 알아본다 → 빠진 것도 남는 것도 없다', () => {
    const plan = detectColumns(HEADERS);
    expect(plan.missing).toEqual([]);
    expect(plan.unknown).toEqual([]);
    expect(plan.fields).toEqual([
      'date', 'cardKind', 'cardLabel', 'vendor', 'industry', 'approvalNo', 'amount',
      'acquireState', 'usageKind', 'currency', 'firstPayDate', 'overseasAmount', 'cancelState'
    ] as (CardField | null)[]);
  });

  it('카드사별 표기 차이도 같은 필드로 본다', () => {
    const plan = detectColumns(['이용일', '상호', '승인금액', '카드번호']);
    expect(plan.fields).toEqual(['date', 'vendor', 'amount', 'cardLabel']);
    expect(plan.missing).toEqual([]);
  });

  it('괄호·공백·대소문자는 열 이름 비교에서 무시한다', () => {
    expect(normalizeHeader('가맹점 명')).toBe(normalizeHeader('가맹점명'));
    expect(detectColumns(['금액(원)', ' 승인 번호 ']).fields).toEqual(['amount', 'approvalNo']);
    // 단위를 붙여 내보내는 카드사·기관 양식이 실제로 있습니다. 닫는 괄호가 없어도 같은 결과를 줍니다.
    expect(detectColumns(['거래일', '가맹점명(영문)', '금액(원', '승인번호(6)']).fields).toEqual(['date', 'vendor', 'amount', 'approvalNo']);
  });

  it('필수 세 열이 없으면 missing 으로 알려 추측 매핑을 막는다', () => {
    const plan = detectColumns(['거래일', '메모', '사유']);
    expect(plan.missing).toEqual(['vendor', 'amount']);
    expect(plan.unknown).toEqual(['메모', '사유']);
  });

  it('같은 필드를 두 번 쓰지 않는다 (먼저 온 열이 승리)', () => {
    const plan = detectColumns(['가맹점명', '상호', '거래일', '결제일']);
    expect(plan.fields).toEqual(['vendor', null, 'date', null]);
  });
});

/* ───────── 행 판정 ───────── */

describe('행 판정', () => {
  it('합계 행과 날짜·금액이 없는 행은 집행 행으로 세지 않는다', () => {
    expect(isAggregateRow({ vendor: '총 1건', date: '', amount: '48500.0' })).toBe(true);
    expect(isAggregateRow({ vendor: '합계', amount: '176,500.0' })).toBe(true);
    expect(isAggregateRow({ vendor: '계' })).toBe(true);
    expect(isAggregateRow({ date: '', vendor: '원단상사', amount: '1' })).toBe(true);
    expect(isAggregateRow({ date: '2026.10.05', vendor: '원단상사', amount: '158,000.0' })).toBe(false);
  });

  it('취소·미확정 행은 넘기고 사유를 남긴다', () => {
    expect(rowIssue({ cancelState: '정상' })).toBeNull();
    expect(rowIssue({ cancelState: '' })).toBeNull();
    expect(rowIssue({ cancelState: '취소' })?.reason).toBe('cancelled');
    expect(rowIssue({ acquireState: '매입대기' })?.reason).toBe('not-final');
    expect(rowIssue({ acquireState: '결제확정' })).toBeNull();
  });

  it('헤더를 못 찾은 격자는 rowsFromGrid 가 null 을 돌려준다', () => {
    expect(rowsFromGrid([['메모', '사유'], ['a', 'b']])).toBeNull();
    expect(rowsFromGrid([])).toBeNull();
    expect(rowsFromGrid([['', ''], ['']])).toBeNull();
  });
});

/* ───────── 행 → 집행 항목 ───────── */

describe('행 → 집행 항목 (알려 준 것만 적는다)', () => {
  const parsed = rowsFromGrid([HEADERS, ...ROWS])!;

  it('전용카드 끝번호를 안 주면 결제경로를 단정하지 않는다', () => {
    const res = mapRows(parsed.rows, {});
    expect(res.entries).toHaveLength(2);
    expect(res.entries.every((e) => e.payMethod === '확인 필요')).toBe(true);
    expect(res.gaps.find((g) => g.kind === 'card-unknown')?.items).toEqual(['본인441*', '본인902*']);
  });

  it('끝번호로만 전용(체크)카드를 가른다 (선불·후불 추측 금지)', () => {
    const res = mapRows(parsed.rows, { dedicatedCardTails: ['441'] });
    expect(res.entries[0].payMethod).toBe('전용(체크)카드');
    expect(res.entries[1].payMethod).toBe('확인 필요');
    expect(res.gaps.find((g) => g.kind === 'card-unknown')?.items).toEqual(['본인902*']);
  });

  it('승인번호로 id 를 만들고 승인번호 칸에 앞자리 0 을 그대로 넣는다', () => {
    const res = mapRows(parsed.rows, {});
    expect(res.entries[0].id).toBe('sa-01234567');
    expect(res.entries[0].approvalNo).toBe('01234567');
    // 예전에는 메모에 `승인 01234567` 로 파묻혔습니다 — 칸으로 옮겼으니 메모에는 두 번 적지 않습니다.
    expect(res.entries[0].memo).not.toContain('승인');
    expect(res.entries[0].memo).toContain('일시불');
    expect(res.entries[0].memo).toContain('결제확정');
  });

  it('긴 승인번호는 화면 상한으로 자른다 — 미리보기·저장·reload 가 같은 id 를 갖습니다', () => {
    // 붙여넣기·열 정합 실패로 승인번호 칸에 공백이나 긴 숫자가 들어오는 경우가 있습니다.
    // receipts.normalizeEntry 는 MAX_APPROVAL_CHARS 로 자르므로, 수입 단계가 같은 상한을 쓰지 않으면
    // 미리보기의 id(sa-잘린값) 와 저장 후 다시 읽은 id(sa-긴값) 가 어긋나 같은 행이 두 번 뜹니다.
    const long = '0'.repeat(MAX_APPROVAL_CHARS + 12);
    const rows = [
      { date: '2026-10-05', vendor: '샘플원단', amount: '12,000', approvalNo: ` ${long} ` },
      { date: '2026-10-06', vendor: '샘플물류', amount: '8,000', approvalNo: long.slice(0, MAX_APPROVAL_CHARS) }
    ] as unknown as Record<CardField, string>[];
    const res = mapRows(rows, {});
    expect(res.entries[0].approvalNo).toHaveLength(MAX_APPROVAL_CHARS);
    expect(res.entries[0].id).toBe(`sa-${long.slice(0, MAX_APPROVAL_CHARS)}`);
    // 잘린 값이 저장 입구를 다시 통과해도 그대로입니다(수입 → 화면 → 저장 왕복 일치).
    expect(normalizeEntry(res.entries[0])!.approvalNo).toBe(res.entries[0].approvalNo);
    expect(normalizeEntry(res.entries[0])!.id).toBe(res.entries[0].id);
    // 잘린 결과끼리 같으면 id 도 같습니다 — 같은 파일 재수입 시 중복이 되지 않습니다.
    expect(res.entries[1].id).toBe(res.entries[0].id);
  });

  it('집행기간을 주면 기간 내·외가 계산되고, 없으면 확인 필요로 남는다', () => {
    const noPeriod = mapRows(parsed.rows, {});
    expect(noPeriod.entries[0].periodState).toBe('확인 필요');
    expect(noPeriod.gaps.some((g) => g.kind === 'period-unknown')).toBe(true);
    const within = mapRows(parsed.rows, { periodFrom: '2026-10-01', periodTo: '2026-10-31' });
    expect(within.entries.map((e) => e.periodState)).toEqual(['기간 내', '기간 내']);
    expect(within.gaps.some((g) => g.kind === 'period-unknown')).toBe(false);
    expect(mapRows(parsed.rows, { periodFrom: '2027-01-01' }).entries[0].periodState).toBe('기간 외');
  });

  it('가맹점→비목 규칙은 부분일치로 걸리고, 안 걸리면 빈 비목으로 남긴다', () => {
    const res = mapRows(parsed.rows, { budgetRules: [{ match: '원단', budgetItem: '재료비' }] });
    expect(res.entries[0].budgetItem).toBe('재료비');
    expect(res.entries[1].budgetItem).toBe('');
    expect(res.gaps.find((g) => g.kind === 'budget-unmapped')?.items).toEqual(['택배대리점']);
  });

  it('증빙은 카드전표·미수취·미제출이 기본이다 (명세서를 원본 확보로 우기지 않는다)', () => {
    for (const e of mapRows(parsed.rows, {}).entries) {
      expect(e.evidenceType).toBe('카드전표(매출전표)');
      expect(e.evidenceState).toBe('미수취');
      expect(e.submitState).toBe('미제출');
    }
    expect(mapRows(parsed.rows, {}).gaps.some((g) => g.kind === 'evidence-unread')).toBe(true);
  });

  it('합계 행을 넣지 않아 금액이 두 배가 되지 않는다', () => {
    const res = mapRows(parsed.rows, {});
    expect(res.entries.reduce((a, e) => a + e.amount, 0)).toBe(176500);
    expect(res.totalRows).toBe(3);
  });

  it('취소·미확정 행은 건너뛰고 그 목록을 gaps 에 남긴다', () => {
    const rows = rowsFromGrid([
      HEADERS,
      ['2026.10.05', '선불', '본인441*', '원단상사', '', '1', '1000', '결제확정', '일시불', '', '', '', '취소'],
      ['2026.10.06', '선불', '본인441*', '택배', '', '2', '2000', '매입대기', '일시불', '', '', '', '']
    ])!;
    const res = mapRows(rows.rows, {});
    expect(res.entries).toHaveLength(0);
    const skipped = res.gaps.find((g) => g.kind === 'row-skipped');
    expect(skipped?.items).toHaveLength(2);
    expect(skipped?.items[0]).toContain('취소상태 취소');
    expect(skipped?.items[1]).toContain('매입구분 매입대기');
  });

  it('날짜·금액을 못 읽는 행도 금액에 섞지 않고 건너뛴다', () => {
    const rows = rowsFromGrid([['거래일', '가맹점명', '금액'], ['2026-10-05', '원단상사', '삼만원']])!;
    const res = mapRows(rows.rows, {});
    expect(res.entries).toHaveLength(0);
    expect(res.gaps.find((g) => g.kind === 'row-skipped')?.items[0]).toContain('읽을 수 없음');
  });
});

/* ───────── .xlsx 읽기 ───────── */

describe('.xlsx (OOXML zip) 읽기', () => {
  it('deflate 로 압축된 항목을 펼쳐 격자로 만든다', async () => {
    const grid = await readXlsx(await xlsxFile([HEADERS, ...ROWS]).arrayBuffer());
    expect(grid[0]).toEqual(HEADERS);
    expect(grid[1][3]).toBe('원단상사');
    expect(grid[1][6]).toBe('158,000.0');
    expect(grid[3][3]).toBe('총 2건');
  });

  it('무압축(stored) 항목도 읽는다', async () => {
    const grid = await readXlsx(await xlsxFile([HEADERS, ...ROWS], { deflate: false }).arrayBuffer());
    expect(grid[1][0]).toBe('2026.10.05 09:14');
  });

  it('inlineStr·숫자·빈 셀·수식 결과(t="str")가 섞인 시트도 열 번호를 유지한다', async () => {
    const xml =
      '<?xml version="1.0"?><worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="inlineStr"><is><t>거래일</t></is></c><c r="C1" t="inlineStr"><is><t>금액</t></is></c><c r="D1" t="inlineStr"><is><t>가맹점명</t></is></c></row>' +
      '<row r="2"><c r="A2" t="inlineStr"><is><t>2026-10-05</t></is></c><c r="B2"/><c r="C2"><v>158000</v></c><c r="D2" t="str"><v>원단&amp;상사</v></c></row>' +
      '</sheetData></worksheet>';
    const grid = await readXlsx(buildZip([{ name: 'xl/worksheets/sheetZ.xml', text: xml }]));
    expect(grid[0]).toEqual(['거래일', '', '금액', '가맹점명']);
    expect(grid[1]).toEqual(['2026-10-05', '', '158000', '원단&상사']);
  });

  it('관계 파일(rels)이 없어도 시트를 찾아낸다', async () => {
    const grid = await readXlsx(await xlsxFile([HEADERS, ROWS[0]], { rels: false }).arrayBuffer());
    expect(grid[1][3]).toBe('원단상사');
  });

  it('zip 이 아닌 바이트에서는 사유를 분명하게 알려준다', async () => {
    await expect(readXlsx(new TextEncoder().encode('this is not a spreadsheet'))).rejects.toThrow(/중앙 디렉토리/);
  });
});

/* ───────── CSV·TSV ───────── */

describe('CSV·TSV 읽기', () => {
  it('따옴표 안의 구분자와 두 번 쓴 따옴표를 한 칸으로 본다', () => {
    expect(parseDelimited('가맹점명,금액\n"원단,상사","1,580,000"\n택배,"센터""점"\n')).toEqual([
      ['가맹점명', '금액'],
      ['원단,상사', '1,580,000'],
      ['택배', '센터"점']
    ]);
  });

  it('첫 행에 탭이 있으면 TSV 로 구분한다', () => {
    expect(parseDelimited('거래일\t가맹점명\t금액\n2026-10-05\t원단상사\t158000')).toEqual([
      ['거래일', '가맹점명', '금액'],
      ['2026-10-05', '원단상사', '158000']
    ]);
  });

  it('BOM·CR 은 제거하고 빈 행은 버린다', () => {
    expect(parseDelimited('﻿거래일,금액\r\n\r\n2026-10-05,1000\r\n')).toEqual([
      ['거래일', '금액'],
      ['2026-10-05', '1000']
    ]);
  });

  it('UTF-8 로 안 읽히면 EUC-KR 로 다시 시도한다 (엑셀 CSV 내보기 기본값)', async () => {
    const text = await decodeTable(Uint8Array.from(EUC_KR_BYTES).slice().buffer as ArrayBuffer);
    expect(text).toContain('원단상사');
    expect(text).toContain('한글');
    expect(text).not.toContain('\uFFFD');
  });

  it('readTableFile 은 확장자가 아니라 내용으로 종목을 가른다', async () => {
    expect((await readTableFile(textFile('a.csv', '거래일,금액\n2026-10-05,1000'))).kind).toBe('csv');
    expect((await readTableFile(textFile('b.tsv', '거래일\t금액\n2026-10-05\t1000'))).kind).toBe('tsv');
    expect((await readTableFile(xlsxFile([HEADERS, ROWS[0]]))).kind).toBe('xlsx');
    // zip 매직으로 시작하지만 내용이 깨진 파일은 조용히 csv 로 넘어가지 않습니다.
    await expect(readTableFile({ name: 'c.xlsx', arrayBuffer: async () => new Uint8Array([0x50, 0x4b, 3, 4, 9, 9]).slice().buffer as ArrayBuffer })).rejects.toThrow(
      /중앙 디렉토리/
    );
  });
});

/* ───────── 끝단: 파일 → 항목 ───────── */

describe('importCardFile 한 번으로 명세서 → 집행 항목', () => {
  it('.xlsx 파일을 주면 항목과 남은 질문을 함께 돌려준다', async () => {
    const res = await importCardFile(xlsxFile([HEADERS, ...ROWS]), {
      dedicatedCardTails: ['441', '902'],
      periodFrom: '2026-10-01',
      periodTo: '2026-12-31',
      budgetRules: [
        { match: '원단', budgetItem: '재료비' },
        { match: '택배', budgetItem: '운송비' }
      ]
    });
    expect(res.entries).toHaveLength(2);
    expect(res.entries[0]).toMatchObject({
      date: '2026-10-05',
      vendor: '원단상사',
      amount: 158000,
      budgetItem: '재료비',
      payMethod: '전용(체크)카드',
      periodState: '기간 내'
    });
    expect(res.headers).toEqual(HEADERS);
    // 설정을 다 채우면 남는 질문은 증빙 확보 한 개뿐입니다.
    expect(res.gaps.map((g) => g.kind)).toEqual(['evidence-unread']);
  });

  it('설정이 하나도 없으면 남는 질문 네 개를 순서대로 알려준다', async () => {
    const res = await importCardFile(xlsxFile([HEADERS, ...ROWS]), {});
    expect(res.gaps.map((g) => g.kind)).toEqual(['card-unknown', 'budget-unmapped', 'period-unknown', 'evidence-unread']);
  });

  it('CSV 도 같은 결과로 들어간다', async () => {
    const res = await importCardFile(textFile('card.csv', '거래일,가맹점명,금액,승인번호\n2026.10.05,원단상사,"158,000.0",01234567\n'), {});
    expect(res.entries).toHaveLength(1);
    expect(res.entries[0].amount).toBe(158000);
    expect(res.entries[0].id).toBe('sa-01234567');
  });

  it('헤더를 못 찾으면 0건 + 사유 + 첫 두 행의 열 이름', async () => {
    const res = await importCardFile(textFile('notes.csv', '메모,사유\na,b\n'), {});
    expect(res.entries).toHaveLength(0);
    expect(res.gaps[0].kind).toBe('column-unknown');
    expect(res.gaps[0].label).toContain('거래일');
    expect(res.gaps[0].items).toEqual(['메모', '사유', 'a', 'b']);
  });

  it('인식하지 못한 열은 값만 버리고 이름은 사용자에게 알린다', async () => {
    const res = await importCardFile(xlsxFile([[...HEADERS, '적립포인트'], ...ROWS.map((r) => [...r, '123'])]), {
      dedicatedCardTails: ['441', '902'],
      budgetRules: [
        { match: '원단', budgetItem: '재료비' },
        { match: '택배', budgetItem: '운송비' }
      ],
      periodFrom: '2026-10-01'
    });
    expect(res.gaps.some((g) => g.kind === 'column-unknown' && g.items.includes('적립포인트'))).toBe(true);
    expect(res.entries).toHaveLength(2);
  });

  it('같은 파일을 두 번 읽어도 id 가 같아 합쳐진다 (중복 추가 방지 화면의 근거)', async () => {
    const a = await importCardFile(xlsxFile([HEADERS, ...ROWS]), {});
    const b = await importCardFile(xlsxFile([HEADERS, ...ROWS]), {});
    expect(a.entries.map((e) => e.id)).toEqual(b.entries.map((e) => e.id));
  });
});

/* ───────── 한 번만 정하면 다음 달엔 그냥 ───────── */

describe('수입 설정 입력란 ↔ 옵션', () => {
  it('끝번호는 쉼표·세미콜론·줄바꿈으로 나누고 빈칸·중복은 버린다', () => {
    expect(parseTails('441, 902 ;441\n본인120*')).toEqual(['441', '902', '본인120*']);
    expect(parseTails('')).toEqual([]);
    expect(parseTails(' , ; \n ')).toEqual([]);
    expect(parseTails(Array.from({ length: 40 }, (_, i) => `${i}`).join(','))).toHaveLength(MAX_CARD_TAILS);
  });

  it('가맹점→비목 규칙은 한 줄에 하나, `#`로 시작하는 줄과 구분자 없는 줄은 넘긴다', () => {
    expect(parseBudgetRuleLines('원단상사=재료비\n# 댓글\n택배=운송비\n모호한 줄\n원단상사=다른 비목')).toEqual([
      { match: '원단상사', budgetItem: '재료비' },
      { match: '택배', budgetItem: '운송비' }
    ]);
    expect(parseBudgetRuleLines('')).toEqual([]);
    expect(parseBudgetRuleLines('=비목만\n가맹점만=')).toEqual([]);
    // 전각 등호(한자판 입력)도 같은 구분자로 봅니다. 문자는 \u 로 적습니다 — 게이트가 리터럴을 막습니다.
    expect(parseBudgetRuleLines('택배\uFF1D운송비')).toEqual([{ match: '택배', budgetItem: '운송비' }]);
  });

  it('같은 가맹점 조각을 두 번 쓰면 첫 줄이 승리한다 (부분일치라 뒤늦은 규칙은 닿지 못하므로)', async () => {
    // '원단' 은 '원단상사' 를 더 넓게 잡는 다른 규칙이라 함께 남습니다. 걸리는 순서는 첫 규칙입니다.
    const rules = parseBudgetRuleLines('원단=재료비\n원단상사=장식비');
    expect(rules).toHaveLength(2);
    const res = await importCardFile(xlsxFile([HEADERS, ROWS[0]]), { budgetRules: rules });
    expect(res.entries[0].budgetItem).toBe('재료비');
  });

  it('화면에 다시 보여줄 때는 같은 형태로 되돌아간다 (edit → save → re-edit 이 줄어들지 않는다)', () => {
    const rules = parseBudgetRuleLines('원단상사=재료비\n택배=운송비');
    expect(parseBudgetRuleLines(formatBudgetRuleLines(rules))).toEqual(rules);
    expect(formatBudgetRuleLines([])).toBe('');
  });

  it('빈 설정은 옵션도 빈칸으로 두어 행이 `확인 필요`·gaps 로 남게 한다', () => {
    const empty = emptyCardSettings();
    const opt = cardSettingsToOptions(empty);
    expect(opt.dedicatedCardTails).toEqual([]);
    expect(opt.periodFrom).toBeUndefined();
    expect(opt.periodTo).toBeUndefined();
    expect(opt.budgetRules).toEqual([]);
    expect(cardSettingsCompleteness(empty)).toEqual({ tails: false, period: false, rules: false });
    const filled = normalizeCardSettings({
      dedicatedCardTails: ['441'],
      periodFrom: '2026-01-01',
      budgetRules: [{ match: '원단', budgetItem: '재료비' }]
    });
    expect(cardSettingsCompleteness(filled)).toEqual({ tails: true, period: true, rules: true });
    expect(cardSettingsToOptions(filled).periodTo).toBeUndefined();
  });

  it('설정을 준 수입과 안 준 수입의 남는 질문 개수가 달라진다', async () => {
    const withSettings = await importCardFile(
      xlsxFile([HEADERS, ...ROWS]),
      cardSettingsToOptions(
        normalizeCardSettings({
          dedicatedCardTails: ['441', '902'],
          periodFrom: '2026-10-01',
          periodTo: '2026-12-31',
          budgetRules: [
            { match: '원단', budgetItem: '재료비' },
            { match: '택배', budgetItem: '운송비' }
          ]
        })
      )
    );
    expect(withSettings.gaps).toHaveLength(1);
    expect(withSettings.entries.every((e) => e.budgetItem !== '')).toBe(true);
  });
});
