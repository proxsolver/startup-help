/**
 * 보고서 모델·HTML renderer 검사.
 * 여기서 고정하는 것은 세 가지입니다: ① 숫자는 화면 요약과 같은 함수에서 나온다 ② 모르는 값은 〔채우기〕
 * ③ 사용자 값은 마크업에 들어가기 전에 이스케이프되어 스크립트가 한 줄도 나오지 않는다.
 */
import { describe, expect, it } from 'vitest';
import { computeTotals, formatKRW } from '../src/lib/receipts';
import type { ReceiptEntry } from '../src/lib/receipts';
import {
  buildReport,
  emptyReportMeta,
  MAX_REPORT_FIELD_CHARS,
  MAX_REPORT_NOTE_CHARS,
  normalizeReportMeta,
  reportBlankCount,
  reportFileName,
  reportGaps,
  REPORT_FIELDS,
  reportToHtml
} from '../src/lib/report';

// 작성 각인·파일 이름의 날짜는 로컬 달력을 씁니다 — ISO 문자열로 고정하면 검사 시간대에 따라 하루가 밀리므로 부품으로 만듭니다.
const NOW = new Date(2026, 9, 25, 9, 0, 0);
const BLANK = '〔채우기〕';

function entry(over: Partial<ReceiptEntry> = {}): ReceiptEntry {
  return {
    id: 'x1',
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

const FILLED = {
  projectName: '2026 모두의 창업 7기',
  applicant: '김민준',
  agency: '신한은행 모두의 창업',
  periodFrom: '2026-07-01',
  periodTo: '2026-12-31',
  contact: '',
  note: ''
};

/** head 를 채운 머리와 같은 형식의 입력(선택 칸까지 다 채운 상태). */
const FILLED_ALL = { ...FILLED, contact: '010-0000-0000', note: '현금 지출은 별도 영수증을 받았습니다.' };

describe('normalizeReportMeta — 저장본·백업 파일 형식 고정', () => {
  it('형식이 아무것도 아니면 빈 머리로 되돌린다', () => {
    for (const bad of [null, undefined, 'x', 12, []]) expect(normalizeReportMeta(bad)).toEqual(emptyReportMeta());
  });

  it('날짜 칸은 YYYY-MM-DD 만 받고 다른 글자는 빈값으로 되돌린다', () => {
    const m = normalizeReportMeta({ periodFrom: '2026-12-01 ', periodTo: '12/01', contact: '2026-13-45' });
    expect(m.periodFrom).toBe('2026-12-01');
    expect(m.periodTo).toBe('');
    expect(m.contact).toBe('2026-13-45'); // 연락처는 날짜 칸이 아니므로 그대로 둡니다.
  });

  it('한 줄 칸은 개행을 공간으로 줄이고, 특이사항만 줄을 살립니다 — 둘 다 길이로 자릅니다', () => {
    const m = normalizeReportMeta({ projectName: `첫 줄\n둘째 줄${' 가'.repeat(200)}` });
    expect(m.projectName).not.toContain('\n');
    expect(m.projectName.length).toBeLessThanOrEqual(MAX_REPORT_FIELD_CHARS);
    // 특이사항의 줄은 그대로 남아야 HTML 의 pre-wrap 과 DOCX 의 문단 나누기가 실제로 돌아갑니다(죽은 경로 방지).
    expect(normalizeReportMeta({ note: '가\n나\r\n다\n\n\n라' }).note).toBe('가\n나\n다\n\n라');
    expect(normalizeReportMeta({ note: `${'나'.repeat(1200)}\n꼬리` }).note.length).toBe(MAX_REPORT_NOTE_CHARS);
  });

  it('알 수 없는 키는 버리고 REPORT_FIELDS 칸만 남긴다', () => {
    const m = normalizeReportMeta({ ...FILLED_ALL, evil: 'x', entries: [entry()] });
    expect(Object.keys(m).sort()).toEqual(REPORT_FIELDS.map((f) => f.key).sort());
  });
});

describe('reportGaps — 필요한 것만 요청한다', () => {
  it('필수 칸이 비면 그 목록대로, 다 채우면 빈 목록', () => {
    expect(reportGaps(emptyReportMeta()).map((g) => g.label)).toEqual([
      '사업명',
      '신청인·대표자',
      '주관 기관',
      '정산 기간 시작',
      '정산 기간 종료'
    ]);
    expect(reportGaps(normalizeReportMeta(FILLED_ALL))).toEqual([]);
  });

  it('선택 칸은 요청하지 않는다', () => {
    const missing = reportGaps(normalizeReportMeta({ ...FILLED, contact: '', note: '' }));
    expect(missing.some((g) => g.label === '연락처')).toBe(false);
    expect(missing.some((g) => g.label === '특이사항')).toBe(false);
  });

  it('요청 목록의 라벨은 보고서에 들어갈 라벨과 정확히 같은 출처다', () => {
    // 화면이 «이것만 채워 주세요» 라고 부르는 칸과 문서에서 〔채우기〕 로 남는 칸이 갈라지면 안 됩니다.
    const gaps = reportGaps(emptyReportMeta()).map((g) => g.key);
    const blanks = buildReport({ entries: [entry()], meta: emptyReportMeta(), generatedAt: NOW })
      .metaRows.filter((m) => m.value === BLANK)
      .map((m) => m.label);
    expect(blanks).toEqual(gaps.map((k) => REPORT_FIELDS.find((f) => f.key === k)!.label));
  });
});

describe('buildReport — 숫자는 화면과 같은 출처', () => {
  const entries = [
    entry(),
    entry({ id: 'x2', date: '2026-10-12', vendor: '검사기관', amount: 900000, budgetItem: '시험·검사·인증', evidenceState: '원본 확보' }),
    entry({ id: 'x3', date: '2026-09-02', vendor: '', amount: 30000, approvalNo: '', payMethod: '확인 필요', periodState: '확인 필요' })
  ];

  it('요약 행은 computeTotals 값을 그대로 쓴다', () => {
    const r = buildReport({ entries, meta: normalizeReportMeta(FILLED), generatedAt: NOW });
    const t = computeTotals(entries);
    expect(r.summaryRows).toEqual([
      { label: '집행 기록', value: `${t.count}건` },
      { label: '총 집행액', value: formatKRW(t.total) },
      { label: '전용(체크)카드 경로', value: `${formatKRW(t.dedicatedTotal)} (${t.dedicatedRate}%)` },
      { label: '증빙 공백(미수취·재요청)', value: `${t.evidenceGapCount}건 · ${formatKRW(t.evidenceGapTotal)}` },
      { label: '기간 확인 필요·기간 외', value: `${t.periodRiskCount}건 · ${formatKRW(t.periodRiskTotal)}` },
      { label: '제출 전', value: `${t.notSubmittedCount}건 · ${formatKRW(t.notSubmittedTotal)}` }
    ]);
  });

  it('집행 목록은 오래된 날짜 먼저, 승인번호가 자체 열로 나온다', () => {
    const r = buildReport({ entries, meta: normalizeReportMeta(FILLED), generatedAt: NOW });
    const rows = r.tables[0].rows;
    expect(rows.map((c) => c[0])).toEqual(['2026-09-02', '2026-10-05', '2026-10-12']);
    expect(rows[1][2]).toBe('01234567');
    expect(rows[0][2]).toBe('—');
    expect(rows[0][1]).toBe('(거래처 미입력)');
    expect(r.tables[0].head).toEqual(['지출일', '거래처', '승인번호', '금액', '비목', '결제경로', '증빙 종류', '수취', '제출']);
    expect(r.tables[0].numColumn).toBe(3);
  });

  it('증빙이 아직 없는 건만 따로 세고, 없으면 사유 문장을 넣는다', () => {
    const r = buildReport({ entries, meta: normalizeReportMeta(FILLED), generatedAt: NOW });
    expect(r.tables[2].rows).toHaveLength(2);
    expect(r.tables[2].rows.map((c) => c[0])).toEqual(['2026-09-02', '2026-10-05']);
    const paid = [entry({ evidenceState: '원본 확보' }), entry({ id: 'x9', evidenceState: '사본·이미지만' })];
    const r2 = buildReport({ entries: paid, meta: normalizeReportMeta(FILLED), generatedAt: NOW });
    expect(r2.tables[2].rows).toHaveLength(0);
    expect(r2.tables[2].emptyNote).toContain('미수취·재요청');
  });

  it('비목별 합계는 키 순으로 정렬되고 액수 합이 총 집행액과 같다', () => {
    const r = buildReport({ entries, meta: normalizeReportMeta(FILLED), generatedAt: NOW });
    const byBudget = r.tables[1];
    const keys = byBudget.rows.map((c) => c[0]);
    expect(keys).toEqual([...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(keys).toEqual(expect.arrayContaining(['재료비', '시험·검사·인증']));
    const sum = byBudget.rows.reduce((s, c) => s + Number(c[2].replace(/[^\d]/g, '')), 0);
    expect(sum).toBe(computeTotals(entries).total);
    expect(byBudget.rows.find((c) => c[0] === '재료비')?.[1]).toBe('2건');
  });

  it('비목이 빈 행은 (미입력) 으로 드러난다 — 없는 게 아니라 안 정한 것', () => {
    const r = buildReport({ entries: [entry({ budgetItem: '' })], meta: normalizeReportMeta(FILLED), generatedAt: NOW });
    expect(r.tables[0].rows[0][4]).toBe('(비목 미정)');
    expect(r.tables[1].rows[0][0]).toBe('(미입력)');
  });

  it('기간 우선순위: 인자 > 머리 범위 > 머리 한쪽 > 이번 달', () => {
    const meta = normalizeReportMeta(FILLED);
    expect(buildReport({ entries, meta, period: '2026-01', generatedAt: NOW }).period).toBe('2026-01');
    expect(buildReport({ entries, meta, generatedAt: NOW }).period).toBe('2026-07-01 ~ 2026-12-31');
    const half = normalizeReportMeta({ ...FILLED, periodTo: '' });
    expect(buildReport({ entries, meta: half, generatedAt: NOW }).period).toBe('2026-07-01');
    expect(buildReport({ entries, meta: emptyReportMeta(), generatedAt: NOW }).period).toBe('2026-10');
  });

  it('화면은 머리에 기간이 있으면 데이터 기간을 빈 문자열로 넘겨 양보한다', () => {
    // `ReceiptTool` 의 사정: 화면 필터 기간(예: 2026-09~2026-10)을 항상 넘기면 머리에 적어 둔
    // 2026-07-01 ~ 2026-12-31 은 한 번도 문서에 못 들어갑니다. 인자를 빈 문자열로 넘기는 자리가
    // 머리 기간을 살리는지 여기까지 고정합니다 — 문서의 정산 기간과 머리·파일 이름이 서로 다른 기간을 말하면 안 됩니다.
    const meta = normalizeReportMeta(FILLED);
    expect(buildReport({ entries, meta, period: '', generatedAt: NOW }).period).toBe('2026-07-01 ~ 2026-12-31');
    // 머리 기간이 아예 없을 때만 데이터 기간이 문서에 나옵니다.
    expect(buildReport({ entries, meta: emptyReportMeta(), period: '2026-09 ~ 2026-10', generatedAt: NOW }).period).toBe(
      '2026-09 ~ 2026-10'
    );
  });

  it('reportBlankCount — 화면이 고지하는 개수가 문서에 실제로 남은 개수입니다', () => {
    // 화면이 저장된 값에서 따로 세면, 방금 적고 「저장」을 안 누른 칸은 고지와 파일이 어긋납니다.
    expect(reportBlankCount(buildReport({ entries, meta: emptyReportMeta(), generatedAt: NOW }))).toBe(5);
    expect(reportBlankCount(buildReport({ entries, meta: normalizeReportMeta(FILLED), generatedAt: NOW }))).toBe(0);
    // 특이사항은 선택이라 개수가 움직이지 않습니다.
    const withNote = buildReport({ entries, meta: normalizeReportMeta({ ...FILLED, note: '첫 줄\n둘째 줄' }), generatedAt: NOW });
    expect(reportBlankCount(withNote)).toBe(0);
    expect(withNote.note).toBe('첫 줄\n둘째 줄');
  });

  it('머리 값이 없으면 〔채우기〕 가 그대로 보고서에 들어 있다', () => {
    const r = buildReport({ entries, meta: emptyReportMeta(), generatedAt: NOW });
    expect(r.metaRows).toHaveLength(REPORT_FIELDS.length - 1); // 특이사항은 머리에 대신 자리표시가 없음
    expect(r.metaRows.filter((m) => m.value === BLANK)).toHaveLength(5);
    // 선택 칸은 요청 목록에 안 나오므로 〔채우기〕 대신 '미기재' 로 적습니다.
    expect(r.metaRows.find((m) => m.label === '연락처')?.value).toBe('미기재');
    expect(r.note).toBe('');
  });

  it('선택 특이사항까지 채우면 빈 칸이 하나도 남지 않는다', () => {
    const r = buildReport({ entries, meta: normalizeReportMeta(FILLED_ALL), generatedAt: NOW });
    expect(r.metaRows.some((m) => m.value === BLANK)).toBe(false);
    expect(r.note).toContain('현금 지출');
  });

  it('행이 0개여도 죽지 않고 사유를 적어 준다', () => {
    const r = buildReport({ entries: [], meta: normalizeReportMeta(FILLED), generatedAt: NOW });
    expect(r.summaryRows[0].value).toBe('0건');
    expect(r.tables[0].rows).toHaveLength(0);
    expect(r.tables[0].emptyNote).toContain('명세서');
  });

  it('entries 가 배열이 아니어도 파일을 만들 수 있다', () => {
    // @ts-expect-error 고장난 입력에서도 요약 행은 나와야 한다
    expect(() => buildReport({ entries: undefined, meta: FILLED, generatedAt: NOW })).not.toThrow();
  });
});

describe('reportToHtml — 스크립트 없는 단일 파일', () => {
  const report = buildReport({
    entries: [entry({ vendor: `<img src=x onerror=alert(1)> A&B "작은따옴표'`, memo: '남에게 보여 줄 메모' })],
    meta: normalizeReportMeta(FILLED),
    generatedAt: NOW
  });
  const html = reportToHtml(report);

  it('스크립트·태그로 살아날 수 있는 조각이 없다', () => {
    expect(html).not.toContain('<script');
    expect(html.toLowerCase()).not.toContain('<img');
    expect(html.toLowerCase()).not.toContain('<iframe');
    expect(html).not.toContain('<img src=x'); // 이스케이프 전 원문 그대로는 등장하지 않습니다.
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('A&amp;B');
    expect(html).toContain('&quot;');
    expect(html).toContain('&#39;');
  });

  it('메모 칸은 문서에 들어가지 않는다 — 화면·CSV 에만 남는다', () => {
    // 카드사 원문 조각(이용구분·매입상태)이 메모로 쌓이는데, 그것을 기관에 넘길 문서에 흐르게 두지 않습니다.
    expect(html).not.toContain('남에게 보여 줄 메모');
  });

  it('lang·인쇄 규칙·비공식 표기가 머리와 각주에 모두 있다', () => {
    expect(html).toContain('<html lang="ko">');
    expect(html).toContain('@page { size: A4; margin: 16mm; }');
    expect(html.match(/비공식/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain('이 파일의 숫자는 전부 사용자 입력');
    expect(html).toContain('PDF로 저장');
  });

  it('표 행 수가 모델과 같고, 빈 표는 문장으로 나온다', () => {
    const rowCount = (s: string) => (s.match(/<tr><td/g) ?? []).length;
    // 픽스처는 집행 1 · 비목별 합계 1 · 증빙 공백 1 = 3행입니다. 숫자를 박아 두지 않으면
    // renderer 가 행을 통째로 빼먹어도 "모델과 같다" 는 검사 자체가 목적표를 잃어 아무 값이나 통과합니다.
    const modelRows = report.tables.reduce((s, t) => s + t.rows.length, 0);
    expect(modelRows).toBe(3);
    expect(rowCount(html)).toBe(modelRows);
    const empty = reportToHtml(buildReport({ entries: [], meta: normalizeReportMeta(FILLED), generatedAt: NOW }));
    expect(empty).toContain('집행 기록이 없습니다');
    expect(empty).not.toContain('<tbody>\n<tr><td>2026');
    expect(rowCount(empty)).toBe(0);
    // 요약 표(class="summary")만 남습니다 — 데이터 표 3개가 빈 문장으로 대체된 증거.
    expect(empty.match(/<table/g)?.length).toBe(1);
    expect(empty.match(/<h2/g)?.length).toBe(4); // 요약 + 표 제목 3개
  });

  it('비어 있는 필수 칸은 다른 색 클래스로 표시된다', () => {
    const blank = reportToHtml(buildReport({ entries: [entry()], meta: emptyReportMeta(), generatedAt: NOW }));
    expect(blank).toContain('class="blank"');
    expect(blank.match(/class="blank"/g)?.length).toBe(5);
    expect(blank).toContain('미기재');
  });

  it('금액 열만 오른쪽 정렬 클래스를 붙인다', () => {
    expect(html).toContain('<td class="num">₩150,000</td>');
    expect(html).not.toContain('<td class="num">01234567</td>');
  });
});

describe('reportFileName — 확장자는 renderer 가 붙인다', () => {
  it('기간의 날짜·구분자는 살리고 위험한 글자는 걷어낸다', () => {
    expect(reportFileName('2026-07-01 ~ 2026-12-31', NOW)).toBe('report_2026-07-01-2026-12-31_20261025');
    expect(reportFileName('2026-10', NOW)).toBe('report_2026-10_20261025');
  });

  it('한글·슬래시·점 여러 개가 들어와도 경로가 깨지지 않는다', () => {
    const name = reportFileName('../정산 기간/2026년 7월', NOW);
    expect(name).not.toContain('/');
    expect(name).not.toContain('..');
    expect(name).toMatch(/^report_[0-9A-Za-z._-]*_20261025$/);
  });

  it('기간이 없으면 all', () => {
    expect(reportFileName('', NOW)).toBe('report_all_20261025');
    expect(reportFileName('   ', NOW)).toBe('report_all_20261025');
  });
});
