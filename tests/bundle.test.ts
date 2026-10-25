import { describe, expect, it } from 'vitest';
import { buildBundle, buildRequestDraft, bundleFileName, dataPeriod } from '../src/lib/bundle';
import { computeTotals, type ReceiptEntry } from '../src/lib/receipts';

function entry(over: Partial<ReceiptEntry> = {}): ReceiptEntry {
  return {
    id: 'x1',
    date: '2026-03-05',
    vendor: '원단상사',
    approvalNo: '',
    amount: 120000,
    budgetItem: '재료비',
    payMethod: '전용(체크)카드',
    evidenceType: '세금계산서',
    evidenceState: '원본 확보',
    periodState: '기간 내',
    submitState: '미제출',
    memo: '',
    ...over
  };
}

const ITEMS = [
  { id: 'setup:bank', label: '정산 계좌를 따로 묶었다' },
  { id: 'setup:card', label: '전용 카드 발급창을 열었다' },
  { id: 'execute:gap', label: '증빙 공백 목록을 만들었다' }
];

// 꾸러미 각인·파일 이름은 로컬 달력 값입니다. ISO 문자열로 고정하면 검사 시간대에 따라 하루가 밀리므로 부품으로 만듭니다.
const NOW = new Date(2026, 3, 11, 9, 30, 0);

describe('buildBundle — 빈 데이터', () => {
  it('기록이 없어도 아홉 절이 다 나오고 "없음" 으로 채운다', () => {
    const text = buildBundle({ entries: [], checklist: {}, items: ITEMS, period: '2026-03', generatedAt: NOW });
    for (const head of ['1. 요약', '2. 증빙 공백', '3. 기간 리스크', '4. 제출 전', '5. 비목별', '6. 결제경로별', '7. 달별', '8. 체크리스트', '9. 담당 기관']) {
      expect(text).toContain(head);
    }
    expect(text).toContain('집행 기록이 없습니다');
    // 숫자를 지어내지 않는다는 원칙: 빈 데이터에서는 합계 줄 자체가 나오면 안 됩니다.
    expect(text).not.toContain('- 총액:');
  });

  it('배열이 아닌 값으로도 죽지 않는다', () => {
    // @ts-expect-error 고장난 호출에도 파일을 만들어 내지 않고 메시지를 낼 수 있어야 한다
    expect(() => buildBundle({ entries: undefined, checklist: undefined, items: undefined })).not.toThrow();
  });
});

describe('buildBundle — 숫자는 사용자 데이터에서만', () => {
  const entries = [
    entry(),
    entry({ id: 'x2', date: '2026-03-20', vendor: '인테리어 업체', amount: 480000, budgetItem: '시제품 제작', payMethod: '현금', evidenceType: '없음', evidenceState: '미수취', submitState: '보완 요청' }),
    entry({ id: 'x3', date: '2026-07-02', vendor: '검사기관', amount: 220000, budgetItem: '시험·검사·인증', periodState: '기간 외', submitState: '제출 완료' }),
    entry({ id: 'x4', date: '2026-03-28', vendor: '', amount: 50000, payMethod: '확인 필요', evidenceState: '재요청함', periodState: '확인 필요' })
  ];
  const totals = computeTotals(entries);
  const text = buildBundle({ entries, checklist: { 'setup:bank': true }, items: ITEMS, period: '2026-03', generatedAt: NOW });

  it('요약 합계는 화면과 같은 computeTotals 값이다', () => {
    expect(text).toContain(`- 집행 기록: ${totals.count}건`);
    expect(text).toContain(`- 증빙 공백(미수취·재요청): ${totals.evidenceGapCount}건`);
    expect(text).toContain(`- 기간 확인 필요·기간 외: ${totals.periodRiskCount}건`);
    expect(text).toContain(`- 제출 전 (제출 완료 아닌 행): ${totals.notSubmittedCount}건`);
  });

  it('전용카드 비율은 이미 0~100 인 값을 그대로 쓴다 (100 번 곱하면 두 배로 부푼다)', () => {
    expect(text).toContain(`(${totals.dedicatedRate}%)`);
    expect(text).not.toContain(`(${totals.dedicatedRate * 100}%)`);
  });

  it('제출 전 목록 건수는 요약 합계와 같은 기준이다', () => {
    const listed = text
      .split('\n')
      .filter((l) => /^\s*20\d\d-\d\d-\d\d\s/.test(l) && /(미제출|보완 요청|초안 포함)/.test(l));
    expect(listed.length).toBe(totals.notSubmittedCount);
  });

  it('공백·리스크 행이 표로 들어 있고 거래처가 없으면 표시를 붙인다', () => {
    expect(text).toContain('미수취');
    expect(text).toContain('재요청함');
    expect(text).toContain('기간 외');
    expect(text).toContain('(거래처 미입력)');
  });

  it('세 표와 기관 요청 초안에 승인번호 열이 들어 있다 (카드사·기관 조회의 키)', () => {
    const withApproval = [
      entry({ id: 'x9', approvalNo: '01234567', evidenceState: '미수취', periodState: '기간 외' }),
      entry({ id: 'x8', vendor: '번호 없는 곳', amount: 5000, evidenceState: '재요청함' })
    ];
    const out = buildBundle({ entries: withApproval, checklist: {}, items: ITEMS, period: '2026-03', generatedAt: NOW });
    // 증빙 공백 · 기간 리스크 · 제출 전 · 요청 초안 네 표가 같은 열 순서를 씁니다.
    expect(out.match(/지출일\s+거래처\s+승인번호\s+금액/g)?.length).toBeGreaterThanOrEqual(4);
    expect(out).toContain('01234567');
    // 빈 승인번호는 칸을 빼지 않고 줄표로 채웁니다 — 열이 어긋나 보이지 않도록.
    const blank = out.split('\n').find((l) => l.includes('번호 없는 곳'));
    expect(blank).toMatch(/번호 없는 곳\s+—\s+₩/);
    const draft = buildRequestDraft(withApproval, { period: '2026-03', generatedAt: NOW });
    expect(draft).toContain('01234567');
  });

  it('비목·결제경로·월별 합계 절에 사용자 값이 들어 있다', () => {
    expect(text).toContain('재료비');
    expect(text).toContain('시제품 제작');
    expect(text).toContain('전용(체크)카드');
    expect(text).toContain('2026-03');
  });

  it('메모에 개행이 있어도 표 행이 갈라지지 않는다', () => {
    const broke = buildBundle({
      entries: [entry({ memo: '첫 줄\n둘째 줄', periodState: '기간 외', evidenceState: '미수취' })],
      checklist: {},
      items: ITEMS,
      period: '2026-03',
      generatedAt: NOW
    });
    const flat = buildBundle({
      entries: [entry({ memo: '첫 줄 둘째 줄', periodState: '기간 외', evidenceState: '미수취' })],
      checklist: {},
      items: ITEMS,
      period: '2026-03',
      generatedAt: NOW
    });
    expect(broke).toBe(flat);
    expect(broke).toContain('첫 줄 둘째 줄');
  });

  it('체크리스트는 끝난 것과 남은 것을 가른다', () => {    expect(text).toContain('[x] 정산 계좌를 따로 묶었다');
    expect(text).toContain('[ ] 전용 카드 발급창을 열었다');
    expect(text).toContain('이미 끝난 항목 1개');
    expect(text).toContain('남은 항목 2개');
  });
});

describe('buildRequestDraft', () => {
  it('모르는 값은 〔〕 자리표시자로 남기고 채워야 한다는 사실을 적는다', () => {
    const draft = buildRequestDraft([entry({ evidenceState: '미수취', vendor: '' })], { period: '2026-03', generatedAt: NOW });
    expect(draft).toContain('〔담당 기관명〕');
    expect(draft).toContain('〔사업명 / 사업번호〕');
    expect(draft).toContain('〔거래처〕');
    expect(draft).toContain('보내기 전에 〔〕 안의 값을 채우고');
    expect(draft).toContain('정산 대상 기간: 2026-03');
    expect(draft).toContain('정리 작성 시각: 2026.04.11');
    expect(draft).toContain('이 초안은 참여자가 자신의 집행 기록을 정리해 만든 초안입니다');
  });

  it('공백이 없으면 요청 대상을 늘어놓지 않는다', () => {
    const draft = buildRequestDraft([entry()], { generatedAt: NOW });
    expect(draft).toContain('증빙 공백은 없습니다');
    expect(draft).not.toContain('요청 대상');
    // 기간을 안 주면 자리표시자로 남긴다 — 이번 달을 지어내지 않는다.
    expect(draft).toContain('정산 대상 기간: 〔예: 2026-07 ~ 2026-12〕');
  });

  it('기관명·담당자처럼 확인할 수 없는 고유 명사를 집어넣지 않는다', () => {
    const draft = buildRequestDraft([entry({ evidenceState: '재요청함' })], { period: '2026-03', generatedAt: NOW });
    expect(draft).not.toMatch(/중소벤처기업부|창업진흥원|K-Startup|전용카드사/);
  });
});

describe('dataPeriod — 기간 필터가 없을 때의 정산 기간', () => {
  it('실제 집행일의 최소~최대 달에서 만든다 (이번 달을 적지 않는다)', () => {
    expect(dataPeriod([entry({ date: '2026-03-05' }), entry({ date: '2026-07-19' })], NOW)).toBe('2026-03~2026-07');
    expect(dataPeriod([entry({ date: '2026-03-05' }), entry({ date: '2026-03-28' })], NOW)).toBe('2026-03');
  });

  it('읽을 수 있는 달이 없으면 이번 달로 돌아간다', () => {
    expect(dataPeriod([], NOW)).toBe('2026-04');
    expect(dataPeriod([entry({ date: '확인 중' })], NOW)).toBe('2026-04');
  });
});

describe('bundleFileName', () => {
  it('기간을 파일 이름 안전 문자로 바꾸어 넣는다', () => {
    expect(bundleFileName('2026-03', NOW)).toBe('kkureomi_2026-03_20260411.txt');
    expect(bundleFileName('2026-03 ~ 2026-09', NOW)).toBe('kkureomi_2026-03_~_2026-09_20260411.txt');
    expect(bundleFileName('', NOW)).toBe('kkureomi_all_20260411.txt');
    expect(bundleFileName('한글 기간', NOW)).toBe('kkureomi_all_20260411.txt');
  });

  it('경로 조각이 들어갈 수 없다', () => {
    expect(bundleFileName('../../etc/passwd', NOW)).not.toContain('/');
  });
});
