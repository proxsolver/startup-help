/**
 * DOCX 조립 검사 — Word 를 이 테스트에서 돌릴 수는 없으므로 **규격이 요구하는 구조**를 확인합니다.
 * ① zip 이 자체로 일관된다(local·central 의 CRC·크기·시각이 같고, 풀면 원문과 같다)
 * ② Word 가 열 세 조각을 모두 담았다 ③ 한글이 eastAsia 글꼴을 지정받아 그려진다
 * ④ 값은 HTML 과 같은 `Report` 모델에서 나온다(행 수·자리표시자·주의색).
 */
import { describe, expect, it } from 'vitest';
import { buildDocx, crc32, docxSupport, reportToDocxBody, reportToDocxXml } from '../src/lib/docx';
import { buildReport, emptyReportMeta, normalizeReportMeta, reportFileName } from '../src/lib/report';
import type { ReportMeta } from '../src/lib/report';
import { computeTotals } from '../src/lib/receipts';
import type { ReceiptEntry } from '../src/lib/receipts';

// 작성 각인은 로컬 getFullYear/getMonth/getDate 를 쓰므로, 고정한 ISO 문자열은 검사를 돌리는 시간대에 따라
// 날짜가 밀립니다(UTC-10 에서 '2026-10-25T09:00:00Z' 는 10-24 입니다). 로컬 부품으로 만들어 시간대와 무관하게 합니다.
const NOW = new Date(2026, 9, 25, 9, 0, 0);
const td = new TextDecoder();

function entry(over: Partial<ReceiptEntry> = {}): ReceiptEntry {
  return {
    id: 'd1',
    date: '2026-10-05',
    vendor: '원단상사',
    approvalNo: '01234567',
    amount: 150000,
    budgetItem: '재료비',
    payMethod: '전용(체크)카드',
    evidenceType: '카드전표(매출전표)',
    evidenceState: '미수취',
    periodState: '기간 내',
    submitState: '미제출',
    memo: '일시불',
    ...over
  };
}

const META: ReportMeta = normalizeReportMeta({
  projectName: '2026 모두의 창업 7기',
  applicant: '김민준',
  agency: '신한은행 모두의 창업',
  periodFrom: '2026-07-01',
  periodTo: '2026-12-31'
});

function report(entries: ReceiptEntry[], meta: ReportMeta = META) {
  return buildReport({ entries, meta, generatedAt: NOW });
}

interface Zipped {
  name: string;
  method: number;
  crc: number;
  compSize: number;
  rawSize: number;
  time: number;
  date: number;
  localCrc: number;
  localCompSize: number;
  localRawSize: number;
  localMethod: number;
  localTime: number;
  localDate: number;
  bytes: Uint8Array;
}

/** 중앙디렉토리를 훑어 각 항목을 펼쳐 돌려줍니다 — 파일이 스스로 모순되지 않는지를 보는 방법입니다. */
async function unzip(file: Uint8Array): Promise<Zipped[]> {
  const dv = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const eocdAt = file.length - 22;
  expect(dv.getUint32(eocdAt, true)).toBe(0x06054b50);
  const count = dv.getUint16(eocdAt + 10, true);
  let p = dv.getUint32(eocdAt + 16, true);
  const out: Zipped[] = [];
  for (let i = 0; i < count; i++) {
    expect(dv.getUint32(p, true)).toBe(0x02014b50);
    const method = dv.getUint16(p + 10, true);
    const time = dv.getUint16(p + 12, true);
    const date = dv.getUint16(p + 14, true);
    const crc = dv.getUint32(p + 16, true);
    const compSize = dv.getUint32(p + 20, true);
    const rawSize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const localAt = dv.getUint32(p + 42, true);
    const name = td.decode(file.slice(p + 46, p + 46 + nameLen));
    // local 헤더의 같은 필드가 central 과 일치해야 규격(ECMA-376-2)을 지키는 zip 입니다.
    expect(dv.getUint32(localAt, true)).toBe(0x04034b50);
    const localMethod = dv.getUint16(localAt + 8, true);
    const localTime = dv.getUint16(localAt + 10, true);
    const localDate = dv.getUint16(localAt + 12, true);
    const localCrc = dv.getUint32(localAt + 14, true);
    const localCompSize = dv.getUint32(localAt + 18, true);
    const localRawSize = dv.getUint32(localAt + 22, true);
    const localNameLen = dv.getUint16(localAt + 26, true);
    const extraLen = dv.getUint16(localAt + 28, true);
    expect(td.decode(file.slice(localAt + 30, localAt + 30 + localNameLen))).toBe(name);
    const dataAt = localAt + 30 + localNameLen + extraLen;
    const packed = file.slice(dataAt, dataAt + compSize);
    const stream = new Blob([packed.slice().buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    expect(bytes.length).toBe(rawSize);
    expect(crc32(bytes)).toBe(crc);
    out.push({ name, method, crc, compSize, rawSize, time, date, localCrc, localCompSize, localRawSize, localMethod, localTime, localDate, bytes });
    p += 46 + nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
  return out;
}

const text = (bytes: Uint8Array) => td.decode(bytes);

describe('crc32 — zip 이 요구하는 검사값', () => {
  it('알려진 값과 같다', () => {
    expect(crc32(new Uint8Array(0))).toBe(0x00000000);
    expect(crc32(new TextEncoder().encode('a'))).toBe(0xe8b7be43);
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});

describe('docxSupport — 만들 수 없는 환경을 숨기지 않는다', () => {
  it('이 실행 환경에서는 압축·Response 가 있다', () => {
    expect(docxSupport()).toEqual({ ok: true, why: '' });
  });

  it('CompressionStream 이 없으면 사유 문장을 돌려준다', () => {
    const g = globalThis as Record<string, unknown>;
    const saved = g.CompressionStream;
    g.CompressionStream = undefined;
    try {
      const support = docxSupport();
      expect(support.ok).toBe(false);
      expect(support.why).toContain('CompressionStream');
      expect(support.why).toContain('HTML');
    } finally {
      g.CompressionStream = saved;
    }
  });

  it('압축이 없는 브라우저에서는 파일을 만든 척하지 않고 거부한다', async () => {
    const g = globalThis as Record<string, unknown>;
    const saved = g.CompressionStream;
    g.CompressionStream = undefined;
    try {
      await expect(buildDocx(report([entry()]), NOW)).rejects.toThrow(/DOCX 를 만들 수 없습니다/);
    } finally {
      g.CompressionStream = saved;
    }
  });
});

describe('buildDocx — zip 구조', () => {
  it('Word 가 열 세 조각을 deflate 로 담고, local·central 값이 어긋나지 않는다', async () => {
    const file = await buildDocx(report([entry(), entry({ id: 'd2', approvalNo: '' })]), NOW);
    expect(file.length).toBeGreaterThan(300);
    expect(file[0]).toBe(0x50); // P
    expect(file[1]).toBe(0x4b); // K
    expect(new DataView(file.buffer, file.byteOffset, file.byteLength).getUint32(file.length - 22, true)).toBe(0x06054b50);
    const parts = await unzip(file);
    expect(parts.map((p) => p.name)).toEqual(['[Content_Types].xml', '_rels/.rels', 'word/document.xml']);
    for (const p of parts) {
      expect(p.method).toBe(8); // method 8(deflate) — zip 은 STORE(0) 도 허용하지만, Word 가 STORE 항목을 받아들인다는 근거를 찾지 못했습니다.
      expect(p.localMethod).toBe(p.method);
      expect(p.localCrc).toBe(p.crc);
      expect(p.localCompSize).toBe(p.compSize);
      expect(p.localRawSize).toBe(p.rawSize);
      expect(p.localTime).toBe(p.time);
      expect(p.localDate).toBe(p.date);
    }
  });

  it('1,000 행 보고서도 같은 zip 구조로 담기고 압축이 실제로 이득을 낸다', async () => {
    // README 에 적힌 'document.xml 7.4MB → .docx 85KB · 조립 84ms' 를 검사로 다시 만들 수 있게 두는 사례입니다.
    // 절대값(바이트·시간)은 기계·시간대에 달라지므로 검사하지 않고, 관계만 봅니다: 원문은 크고 파일은 그보다 작아야 합니다.
    const many = Array.from({ length: 1000 }, (_, i) =>
      entry({ id: `d${i}`, vendor: `원단상사${i}`, approvalNo: `012345${String(i).padStart(3, '0')}`, amount: 1000 + i })
    );
    const made = report(many);
    expect(made.tables[0].rows).toHaveLength(1000);
    const body = reportToDocxBody(made);
    const file = await buildDocx(made, NOW);
    expect(body.length).toBeGreaterThan(1_000_000);
    expect(file.length).toBeLessThan(body.length);
    const parts = await unzip(file);
    expect(parts.map((p) => p.name)).toEqual(['[Content_Types].xml', '_rels/.rels', 'word/document.xml']);
    // 문단표시 rPr 을 되돌린 뒤에도 행당 달리는 개수는 같습니다(본문 1,000 행 + 머리 1 행의 각 칸).
    expect((body.match(/<w:pPr>/g) ?? []).length).toBe((body.match(/<\/w:pPr>/g) ?? []).length);
  });

  it('본문·종류·관계 파일이 서로 맞는 내용이다', async () => {
    const parts = await unzip(await buildDocx(report([entry()]), NOW));
    const byName = new Map(parts.map((p) => [p.name, text(p.bytes)]));
    expect(byName.get('[Content_Types].xml')).toContain('wordprocessingml.document.main+xml');
    expect(byName.get('_rels/.rels')).toContain('officeDocument/2006/relationships/officeDocument');
    expect(byName.get('word/document.xml')).toBe(reportToDocxXml(report([entry()])));
  });

  it('MS-DOS 시각은 1980 년 이후로만, 주어진 시각에서 나온다', async () => {
    const parts = await unzip(await buildDocx(report([entry()]), NOW));
    const { time, date } = parts[0];
    expect((date >> 9) + 1980).toBe(2026);
    expect((date >> 5) & 0x0f).toBe(10);
    expect(date & 0x1f).toBe(25);
    expect(time >> 11).toBe(NOW.getHours());
    // 1979 년 이전 시각은 zip 형식이 표현하지 못합니다. 연도 비트만 1980 으로 고치면 달·일이 남아
    // 1969-12-31 이 1980-12-31 이 되므로(처음엔 그렇게 짰습니다), 그때는 아예 1980-01-01 00:00:00 으로 내립니다.
    const old = await unzip(await buildDocx(report([entry()]), new Date('1969-12-31T23:59:59Z')));
    expect((old[0].date >> 9) + 1980).toBe(1980);
    expect((old[0].date >> 5) & 0x0f).toBe(1);
    expect(old[0].date & 0x1f).toBe(1);
    expect(old[0].time).toBe(0);
  });
});

describe('reportToDocxXml — Word 본문', () => {
  const xml = reportToDocxXml(report([entry(), entry({ id: 'd2', vendor: '<img src=x onerror=alert(1)>', evidenceState: '재요청함' })]));

  it('한글을 그릴 글꼴을 모든 run 에 지정한다', () => {
    expect(xml).toContain('w:eastAsia="맑은 고딕"');
    expect(xml.match(/<w:rFonts /g)?.length).toBeGreaterThan(0);
    // 글꼴 지정 없이 달리는 run 은 Word 기본 글꼴(Calibri)로 떨어집니다 — run 개수와 지정 개수가 같아야 합니다.
    expect(xml.match(/<w:r><w:rPr><w:rFonts /g)?.length).toBe((xml.match(/<w:r>/g) ?? []).length);
  });

  it('값 앞뒤 공백을 보존하는 w:t 만 쓴다', () => {
    expect(xml).toContain('<w:t xml:space="preserve">');
    expect(xml.match(/<w:t>/g)).toBeNull();
  });

  it('행이 머리보다 많은 칸을 가져도 폭 속성이 규격 밖 값으로 빠지지 않는다', () => {
    // 열 폭은 머리 기준으로 계산합니다(`columnWidths`). 모델이 어긋난 표가 들어오면 마지막 열에 폭이 없어
    // `w:w="undefined"` 가 되고, 그 한 속성이 표 전체를 판독기에게 이상한 파일로 만듭니다.
    const made = report([entry()]);
    const t = made.tables[0];
    t.rows = t.rows.map((row) => [...row, '여는 칸']);
    const body = reportToDocxBody(made);
    expect(body).not.toContain('undefined');
    expect(body).toContain('w:type="dxa"');
    // 모든 폭 자리가 숫자입니다(재사용한 마지막 열 폭 포함) — 문자열 하나가 섞이면 표가 통째로 이상해집니다.
    expect(body).not.toMatch(/w:w="[^0-9]/);
    expect((body.match(/<w:tc>/g) ?? []).length).toBe((body.match(/<w:tcW /g) ?? []).length);
  });

  it('사용자 값은 이스케이프되어 태그로 살아나지 않는다', () => {
    expect(xml).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(xml).not.toContain('<img');
    expect(xml).not.toContain('onerror=alert(1)>');
    const quotes = reportToDocxXml(report([entry({ vendor: `A&B '작은' "큰"` })]));
    expect(quotes).toContain('A&amp;B &apos;작은&apos; &quot;큰&quot;');
  });

  it('XML 로 금지된 제어문자는 사라진다', () => {
    const dirty = reportToDocxXml(report([entry({ vendor: '상사\u0001\u0000\u000B' })]));
    expect(dirty).not.toContain('\u0001');
    expect(dirty).not.toContain('\u0000');
    expect(dirty).toContain('상사');
  });

  it('A4 세로·16mm 여백을 페이지 설정에 박는다', () => {
    expect(xml).toContain('<w:pgSz w:w="11906" w:h="16838"/>');
    expect(xml).toContain('<w:pgMar w:top="907" w:right="907" w:bottom="907" w:left="907"');
    expect((xml.match(/<w:sectPr>/g) ?? []).length).toBe(1);
    expect(xml.endsWith('</w:sectPr></w:body></w:document>')).toBe(true);
  });

  it('표마다 열 폭 합이 본문 폭(10092)과 같아 페이지 밖으로 넘어가지 않는다', () => {
    const grids = [...xml.matchAll(/<w:tblGrid>(.*?)<\/w:tblGrid>/g)].map((m) => m[1] ?? '');
    expect(grids.length).toBe(5); // 머리·요약 + 표 3장
    for (const grid of grids) {
      const widths = [...grid.matchAll(/<w:gridCol w:w="(\d+)"/g)].map((m) => Number(m[1]));
      expect(widths.reduce((a, b) => a + b, 0)).toBe(10092);
      expect(Math.min(...widths)).toBeGreaterThanOrEqual(620);
    }
  });

  it('머리·요약·표 3장이 HTML 과 같은 순서로 나오고, 행 수가 모델과 같다', () => {
    const r = report([entry(), entry({ id: 'd2' })]);
    const body = reportToDocxBody(r);
    const order = ['보고서 머리', '요약', '1. 집행 목록', '2. 비목별 합계', '3. 증빙이 아직 없는 건'].map((s) => body.indexOf(s));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(body).toContain('1. 집행 목록 (2행)');
    // 표마다 머리 행 1 + 데이터 행 n — 모델의 행 수와 파일의 행 수가 같아야 화면과 문서가 갈라지지 않습니다.
    const trCount = (body.match(/<w:tr>/g) ?? []).length;
    const expected = 1 + r.metaRows.length + 1 + r.summaryRows.length + r.tables.reduce((s, t) => s + 1 + t.rows.length, 0);
    expect(trCount).toBe(expected);
  });

  it('행이 0개인 표는 빈 표가 아니라 사유 문장으로 들어간다', () => {
    const body = reportToDocxBody(report([]));
    expect(body).toContain('집행 기록이 없습니다');
    expect(body.match(/<w:tbl>/g)?.length).toBe(2); // 머리·요약 표만
    expect(body).toContain('<w:i/>');
  });

  it('숫자는 화면 요약과 같은 computeTotals 값이다', () => {
    const entries = [entry(), entry({ id: 'd3', amount: 40000 })];
    const body = reportToDocxBody(report(entries));
    const t = computeTotals(entries);
    expect(body).toContain(`${t.count}건`);
    expect(body).toContain(`${t.dedicatedRate}%`);
    expect(body).toContain('₩190,000');
  });

  it('채우지 않은 필수 칸은 〔채우기〕 + 주의색, 채운 칸은 주의색이 없다', () => {
    // 색은 한 문단에 두 번 들어갑니다(run + 문단표시) — 개수를 셀 때 둘 다 세는 게 기준입니다.
    const blank = reportToDocxBody(report([entry()], emptyReportMeta()));
    expect(blank).toContain('〔채우기〕');
    expect(blank).toContain('미기재');
    // 필수 5칸 × 2 + 각주 1문단 × 2 = 12. 「이상」으로 두면 칸이 색을 통째로 잃어도 잡힙니다.
    expect((blank.match(/w:val="A5670A"/g) ?? []).length).toBe(12);
    const filled = reportToDocxBody(report([entry()], META));
    expect(filled).not.toContain('〔채우기〕');
    // 채운 머리에는 〔채우기〕 칸이 없으므로 주의색은 각주의 비공식 안내 문단 하나(=2 곳)뿐입니다.
    expect((filled.match(/w:val="A5670A"/g) ?? []).length).toBe(2);
  });

  it('비공식 고지가 머리·각주 두 번, 스크립트·외부 참조는 없다', () => {
    expect((xml.match(/비공식/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(xml).not.toContain('<w:script');
    expect(xml).not.toContain('r:id');
    expect(xml).not.toContain('r:embed');
  });

  it('특이사항은 저장 경로부터 문단으로 나뉩니다', () => {
    // normalizeReportMeta 가 특이사항의 개행을 살려 두므로(한 줄 칸과 다름), 화면→저장→문서 경로가 실제로 쪼개집니다.
    // 여기가 한 줄로 눌러 버리면 HTML 의 pre-wrap 과 아래 분기는 함께 죽은 코드가 됩니다.
    const meta = normalizeReportMeta({ ...META, note: '첫째 줄\n둘째 줄' });
    expect(meta.note).toBe('첫째 줄\n둘째 줄');
    const body = reportToDocxBody(report([entry()], meta));
    expect(body).toContain('<w:t xml:space="preserve">첫째 줄</w:t>');
    expect(body).toContain('<w:t xml:space="preserve">둘째 줄</w:t>');
    expect(body).not.toContain('<w:t xml:space="preserve">첫째 줄\n둘째 줄</w:t>');
  });

  it('행 안의 개행·탭은 셀에 들어가지 전에 한 칸이 됩니다', () => {
    // 붙여넣기로 들어온 값입니다. `xml:space="preserve"` 는 그 줄바꿈까지 보존하므로 쓰기 전에 압니다.
    const body = reportToDocxBody(report([entry({ vendor: '원단\n\t상사' })]));
    expect(body).toContain('<w:t xml:space="preserve">원단 상사</w:t>');
    expect(body).not.toContain('<w:t xml:space="preserve">원단\n');
  });

  it('문단표시에도 글꼴·크기가 들어간다 — Word 는 행 높이를 여기서 계산합니다', () => {
    // pPr 에 rPr 이 없으면 표 안의 7.5pt 셀도 판독기 기본 크기까지 부풀고 빈 문단 여백이 두 배가 됩니다.
    const body = reportToDocxBody(report([entry()]));
    expect((body.match(/<\/w:rPr><\/w:pPr>/g) ?? []).length).toBe((body.match(/<w:pPr>/g) ?? []).length);
    // 표 셀 문단의 표시 크기는 그 셀 run 과 같습니다(15 = 7.5pt).
    expect(body).toContain('<w:rPr><w:rFonts w:ascii="Malgun Gothic" w:eastAsia="맑은 고딕" w:hAnsi="Malgun Gothic"/><w:color w:val="14181F"/><w:sz w:val="15"/></w:rPr>');
  });

  it('금액 열만 오른쪽 정렬된다', () => {
    const body = reportToDocxBody(report([entry()]));
    expect(body).toContain('<w:jc w:val="right"/>');
    expect(body).not.toContain('<w:jc w:val="center"/>');
    // 승인번호는 정렬하지 않아 앞자리 0 이 글자로 남습니다.
    expect(body).toContain('<w:t xml:space="preserve">01234567</w:t>');
  });
});

describe('파일 이름', () => {
  it('docx 확장자는 화면에서 붙인다 — 라이브러리는 이름을 모른다', () => {
    expect(reportFileName('2026-10', NOW)).toBe('report_2026-10_20261025');
  });
});
