import { describe, expect, it } from 'vitest';
import {
  CSV_BOM,
  CSV_COLUMN_COUNT,
  CSV_HEADER,
  computeTotals,
  csvFileName,
  evidenceGapList,
  exportPeriod,
  filterEntries,
  formatKRW,
  MAX_APPROVAL_CHARS,
  migrateLegacyEntry,
  normalizeEntry,
  sanitizeEntries,
  toCsv,
  toCsvFile,
  type ReceiptEntry
} from '../src/lib/receipts';

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

function legacy(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'l1',
    date: '2026-03-05',
    vendor: '원단상사',
    amount: 50000,
    payMethod: '카드',
    evidenceType: '신용카드매출전표',
    category: '매입·원재료',
    regularEvidence: true,
    memo: 'v1 데이터',
    ...over
  };
}

describe('normalizeEntry', () => {
  it('유효한 입력을 그대로 받아들이고 금액을 반올림한다', () => {
    const e = normalizeEntry({
      date: '2026-03-05',
      vendor: '  A  ',
      amount: 1004.6,
      budgetItem: '  광고·마케팅 ',
      evidenceType: '현금영수증',
      payMethod: '현금'
    });
    expect(e?.amount).toBe(1005);
    expect(e?.vendor).toBe('A');
    expect(e?.budgetItem).toBe('광고·마케팅');
    expect(e?.id).toBeTruthy();
  });

  it('v4 저장본(승인번호 칸이 없던 형식)은 빈 승인번호로 승격한다', () => {
    expect(normalizeEntry({ date: '2026-03-05', amount: 10 })?.approvalNo).toBe('');
  });

  it('수입기가 만든 행은 id 에서 승인번호를 되찾고 메모의 중복 조각을 지운다', () => {
    const e = normalizeEntry({
      id: 'sa-01234567',
      date: '2026-03-05',
      amount: 10,
      memo: '승인 01234567 · 일시불 · 결제확정'
    });
    expect(e?.approvalNo).toBe('01234567');
    expect(e?.memo).toBe('일시불 · 결제확정');
    // 조각이 메모 전체였던 행은 빈 메모로 남습니다(정보가 사라지는 것이 아니라 칸으로 옮긴 것입니다).
    expect(normalizeEntry({ id: 'sa-01234567', date: '2026-03-05', amount: 10, memo: '승인 01234567' })?.memo).toBe('');
    // 세 번 지나가도 결과가 같아야 합니다(멱등) — 저장할 때마다 메모가 깎여 나가면 안 됩니다.
    const twice = normalizeEntry({ id: e!.id, date: e!.date, amount: e!.amount, approvalNo: e!.approvalNo, memo: e!.memo });
    expect(twice?.memo).toBe('일시불 · 결제확정');
    expect(twice?.approvalNo).toBe('01234567');
  });

  it('직접 입력한 메모는 승인번호 칸이 있어도 손대지 않는다', () => {
    const e = normalizeEntry({
      id: 'rAbC12345',
      date: '2026-03-05',
      amount: 10,
      approvalNo: ' 01234567 ',
      memo: '승인 01234567 건 확인'
    });
    expect(e?.approvalNo).toBe('01234567');
    expect(e?.memo).toBe('승인 01234567 건 확인');
  });

  it('수입 행의 id 는 승인번호가 아닌 번호일 수 있다 — 메모에 조각이 없으면 되찾지 않는다', () => {
    // 명세서에 승인번호가 없는 달, 수입기는 조회번호·영수번호를 같은 자리에 넣습니다(`COLUMN_ALIASES`)이고
    // 그 값이 `sa-<숫자>` 가 됩니다. id 만 믿으면 승인번호 아닌 값이 승인번호 열에 박힙니다.
    const e = normalizeEntry({ id: 'sa-99887766', date: '2026-03-05', amount: 10, memo: '일시불 · 결제확정' });
    expect(e?.approvalNo).toBe('');
    expect(e?.memo).toBe('일시불 · 결제확정');
    // 사용자가 승인번호 칸을 비면 그대로 비어 있어야 합니다 — 빈칸은 결정이지 정보가 아닙니다.
    const cleared = normalizeEntry({ id: 'sa-01234567', date: '2026-03-05', amount: 10, approvalNo: '', memo: '일시불' });
    expect(cleared?.approvalNo).toBe('');
    expect(cleared?.memo).toBe('일시불');
  });

  it('id 가 다른 형식이면 메모에서 되찾지 않는다 (번호 없는 수입 행)', () => {
    const e = normalizeEntry({
      id: 'sa-2026-03-05-1500-원단상사',
      date: '2026-03-05',
      amount: 10,
      memo: '승인 01234567 · 일시불'
    });
    expect(e?.approvalNo).toBe('');
    expect(e?.memo).toContain('승인 01234567');
  });

  it('승인번호 상한은 잘라서 받아들이고 앞자리 0 을 보존한다', () => {
    const e = normalizeEntry({ date: '2026-03-05', amount: 10, approvalNo: `0${'1'.repeat(40)}` });
    expect(e?.approvalNo).toHaveLength(MAX_APPROVAL_CHARS);
    expect(e?.approvalNo.startsWith('0')).toBe(true);
  });

  it('날짜 형식·금액 오류는 항목을 버린다', () => {
    expect(normalizeEntry({ date: '2026-3-5', amount: 100 })).toBeNull();
    expect(normalizeEntry({ date: '2026-03-05', amount: -5 })).toBeNull();
    expect(normalizeEntry({ date: '2026-03-05', amount: NaN })).toBeNull();
    expect(normalizeEntry(null)).toBeNull();
    expect(normalizeEntry('nope')).toBeNull();
  });

  it('알 수 없는 열거 값은 안전한 기본값으로 바꾼다', () => {
    const e = normalizeEntry({
      date: '2026-03-05',
      amount: 10,
      payMethod: '코인',
      evidenceType: '따따블',
      evidenceState: '완료',
      periodState: '모름',
      submitState: '다함'
    });
    expect(e?.payMethod).toBe('확인 필요');
    expect(e?.evidenceType).toBe('없음');
    expect(e?.evidenceState).toBe('미수취');
    expect(e?.periodState).toBe('확인 필요');
    expect(e?.submitState).toBe('미제출');
  });

  it('빈 비목은 기타로 채운다', () => {
    expect(normalizeEntry({ date: '2026-03-05', amount: 10, budgetItem: '   ' })?.budgetItem).toBe('기타');
  });
});

describe('v1 → v2 마이그레이션', () => {
  it('레거시 항목은 새 필드로 승격된다', () => {
    const e = normalizeEntry(legacy());
    expect(e?.budgetItem).toBe('매입·원재료');
    expect(e?.payMethod).toBe('확인 필요');
    expect(e?.evidenceType).toBe('카드전표(매출전표)');
    expect(e?.evidenceState).toBe('원본 확보');
    expect(e?.periodState).toBe('확인 필요');
    expect(e?.submitState).toBe('미제출');
  });

  it('v1 의 기타영수증은 간이영수증으로 옮긴다', () => {
    expect(normalizeEntry(legacy({ evidenceType: '기타영수증' }))?.evidenceType).toBe('간이영수증');
  });

  it('v1 에서 증빙 없음이던 항목은 미수취가 된다', () => {
    const e = normalizeEntry(legacy({ evidenceType: '없음' }));
    expect(e?.evidenceType).toBe('없음');
    expect(e?.evidenceState).toBe('미수취');
  });

  it('문자열이 아닌 항목·알 수 없는 결제수단은 기본값으로 보정한다', () => {
    expect(migrateLegacyEntry({ payMethod: '가상계좌' }).payMethod).toBe('가상계좌');
    const e = normalizeEntry({ date: '2026-03-05', amount: 1, payMethod: 42 });
    expect(e?.payMethod).toBe('확인 필요');
  });

  it('배열이 아니면 빈 목록, 일부 오류 행만 걸러낸다', () => {
    expect(sanitizeEntries(undefined)).toEqual([]);
    expect(sanitizeEntries('x')).toEqual([]);
    const ok = sanitizeEntries([entry(), { date: 'x', amount: 1 }, entry({ id: 'x2', amount: 5000 }), legacy({ id: 'l2' })]);
    expect(ok).toHaveLength(3);
    expect(ok.map((e) => e.id)).toEqual(['x1', 'x2', 'l2']);
  });
});

describe('filterEntries', () => {
  const list = [
    entry({ id: 'a', date: '2026-03-01', amount: 1000, budgetItem: '사무·운영', vendor: '통신사' }),
    entry({
      id: 'b',
      date: '2026-03-20',
      amount: 2000,
      budgetItem: '출장·교통',
      evidenceType: '없음',
      evidenceState: '미수취',
      periodState: '기간 외',
      submitState: '보완 요청',
      payMethod: '개인카드',
      memo: '택배비'
    }),
    entry({ id: 'c', date: '2026-04-02', amount: 3000, budgetItem: '사무·운영', submitState: '제출 완료' })
  ];

  it('시작일·종료일은 경계를 포함해 자른다', () => {
    expect(filterEntries(list, { from: '2026-03-01', to: '2026-03-20' }).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('비목·증빙·수취·기간·제출·결제경로로 걸러낸다', () => {
    expect(filterEntries(list, { budgetItem: '사무·운영' }).map((e) => e.id)).toEqual(['a', 'c']);
    expect(filterEntries(list, { evidenceType: '없음' }).map((e) => e.id)).toEqual(['b']);
    expect(filterEntries(list, { evidenceState: '미수취' }).map((e) => e.id)).toEqual(['b']);
    expect(filterEntries(list, { periodState: '기간 외' }).map((e) => e.id)).toEqual(['b']);
    expect(filterEntries(list, { submitState: '제출 완료' }).map((e) => e.id)).toEqual(['c']);
    expect(filterEntries(list, { payMethod: '전용(체크)카드' }).map((e) => e.id)).toEqual(['a', 'c']);
  });

  it('검색어는 거래처·메모·비목·승인번호를 대소문자 없이 본다', () => {
    expect(filterEntries(list, { q: '택배' }).map((e) => e.id)).toEqual(['b']);
    expect(filterEntries(list, { q: ' 통신사 ' }).map((e) => e.id)).toEqual(['a']);
    expect(filterEntries(list, { q: '없는단어' })).toEqual([]);
    // 앞자리 0 을 빼도 찾습니다(부분 일치).
    const withApproval = [...list, entry({ id: 'd', approvalNo: '01234567' })];
    expect(filterEntries(withApproval, { q: '01234567' }).map((e) => e.id)).toEqual(['d']);
    expect(filterEntries(withApproval, { q: '1234567' }).map((e) => e.id)).toEqual(['d']);
  });

  it('필터 없음은 전체', () => {
    expect(filterEntries(list)).toHaveLength(3);
  });
});

describe('computeTotals', () => {
  it('전용카드 비율·수취구멍·기간 리스크·미제출을 나누어 집계한다', () => {
    const totals = computeTotals([
      entry({ id: 'a', amount: 50000, date: '2026-03-02', budgetItem: '사무·운영' }),
      entry({
        id: 'b',
        amount: 30000,
        date: '2026-03-30',
        budgetItem: '사무·운영',
        payMethod: '개인카드',
        evidenceState: '재요청함'
      }),
      entry({
        id: 'c',
        amount: 20000,
        date: '2026-04-09',
        budgetItem: '재료비',
        payMethod: '현금',
        evidenceType: '간이영수증',
        evidenceState: '미수취',
        periodState: '기간 외',
        submitState: '제출 완료'
      })
    ]);
    expect(totals.total).toBe(100000);
    expect(totals.count).toBe(3);
    expect(totals.dedicatedTotal).toBe(50000);
    expect(totals.dedicatedRate).toBe(50);
    expect(totals.evidenceGapCount).toBe(2);
    expect(totals.evidenceGapTotal).toBe(50000);
    expect(totals.periodRiskCount).toBe(1);
    expect(totals.periodRiskTotal).toBe(20000);
    expect(totals.notSubmittedCount).toBe(2);
    expect(totals.notSubmittedTotal).toBe(80000);
    expect(totals.byBudgetItem.find((g) => g.key === '사무·운영')).toEqual({ key: '사무·운영', count: 2, total: 80000 });
    expect(totals.byMonth.map((g) => g.key)).toEqual(['2026-03', '2026-04']);
  });

  it('빈 목록에서 0 과 0% 를 돌려주고 0으로 나누지 않는다', () => {
    const t = computeTotals([]);
    expect(t.total).toBe(0);
    expect(t.dedicatedRate).toBe(0);
    expect(t.evidenceGapCount).toBe(0);
    expect(t.byBudgetItem).toEqual([]);
    expect(t.byMonth).toEqual([]);
  });

  it('전액이 전용카드일 때 비율은 100', () => {
    const t = computeTotals([entry({ amount: 1000 }), entry({ amount: 2000 })]);
    expect(t.dedicatedRate).toBe(100);
    expect(t.notSubmittedCount).toBe(2);
  });

  it('비목 합계는 금액 내림차순', () => {
    const t = computeTotals([
      entry({ id: 'a', amount: 100, budgetItem: '기타' }),
      entry({ id: 'b', amount: 900, budgetItem: '시제품 제작' }),
      entry({ id: 'c', amount: 400, budgetItem: '광고·마케팅' })
    ]);
    expect(t.byBudgetItem.map((g) => g.key)).toEqual(['시제품 제작', '광고·마케팅', '기타']);
  });
});

describe('evidenceGapList', () => {
  it('미수취·재요청만 남기고 오래된 순으로 정렬한다', () => {
    const gaps = evidenceGapList([
      entry({ id: 'a', date: '2026-03-20', evidenceState: '재요청함' }),
      entry({ id: 'b', date: '2026-03-05', evidenceState: '원본 확보' }),
      entry({ id: 'c', date: '2026-03-10', evidenceState: '미수취' }),
      entry({ id: 'd', date: '2026-03-15', evidenceState: '사본·이미지만' })
    ]);
    expect(gaps.map((e) => e.id)).toEqual(['c', 'a']);
  });

  it('입력 배열을 바꾸지 않는다', () => {
    const list = [entry({ id: 'a', evidenceState: '미수취' }), entry({ id: 'b', evidenceState: '재요청함' })];
    const before = list.map((e) => e.id);
    evidenceGapList(list);
    expect(list.map((e) => e.id)).toEqual(before);
  });
});

describe('CSV 내보내기', () => {
  it('CRLF 줄구분, 헤더 12열, BOM 은 파일 생성 단계에서만 붙는다', () => {
    const csv = toCsv([entry({ amount: 1500 })]);
    expect(csv).not.toContain(CSV_BOM);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0].split(',')).toHaveLength(CSV_COLUMN_COUNT);
    expect(CSV_COLUMN_COUNT).toBe(12);
    expect(lines[0]).toBe(CSV_HEADER.join(','));
    expect(CSV_HEADER).toContain('비목(예산과목)');
    // 승인번호는 거래처 바로 다음 — 화면 표와 같은 순서입니다.
    expect(CSV_HEADER.slice(2, 5)).toEqual(['거래처', '승인번호', '금액']);
    expect(toCsvFile([entry()]).charCodeAt(0)).toBe(0xfeff);
  });

  it('승인번호는 앞자리 0 을 살려 그 열로 내보낸다', () => {
    const line = toCsv([entry({ approvalNo: '01234567' })]).split('\r\n')[1];
    expect(line).toContain('원단상사,01234567,120000');
  });

  it('전용카드 여부는 Y/N 으로 표시', () => {
    expect(toCsv([entry({ payMethod: '전용(체크)카드' })])).toContain(',Y,');
    expect(toCsv([entry({ payMethod: '개인카드' })])).toContain(',N,');
    expect(toCsv([entry({ payMethod: '확인 필요' })])).toContain(',N,');
  });

  it('행마다 열 수가 헤더와 같다', () => {
    const lines = toCsv([entry({ id: 'a' }), entry({ id: 'b', memo: '쉼표, 포함' })]).split('\r\n');
    for (const line of lines) expect(line.split(',').length).toBeGreaterThanOrEqual(CSV_COLUMN_COUNT);
    expect(lines).toHaveLength(3);
  });

  it('쉼표·따옴표·개행·앞뒤 공백을 인용부호로 감싼다', () => {
    const csv = toCsv([entry({ vendor: 'A,B', memo: 'say "hi"' })]);
    expect(csv).toContain('"A,B"');
    expect(csv).toContain('"say ""hi"""');
    const wrapped = toCsv([entry({ memo: '줄바꿈\n포함' })]);
    expect(wrapped).toContain('"줄바꿈\n포함"');
  });

  it('수식으로 해석될 수 있는 값은 셀 앞에 작은따옴표를 붙여 텍스트로 고정한다', () => {
    // 인용 부호만으로는 엑셀·구글시트가 "=..." 를 계산하는 것을 막지 못합니다.
    expect(toCsv([entry({ vendor: '=SUM(A1)' })])).toContain('"\'=SUM(A1)"');
    expect(toCsv([entry({ memo: '+1' })])).toContain('"\'+1"');
    expect(toCsv([entry({ memo: '-1' })])).toContain('"\'-1"');
    expect(toCsv([entry({ memo: '@cmd' })])).toContain('"\'@cmd"');
    // 값 자체를 지우거나 바꾸지 않습니다 — 접두만 붙습니다.
    expect(toCsv([entry({ vendor: '=SUM(A1)' })])).toContain('SUM(A1)');
  });

  it('앞에 공백·탭이 있어 숨겨진 수식도 같은 방식으로 고정한다', () => {
    // 첫 글자가 공백이어도 시트를 옮겨 붙이는 동안 수식으로 살아날 수 있어 같이 처리합니다.
    expect(toCsv([entry({ vendor: ' =SUM(A1)' })])).toContain('"\' =SUM(A1)"');
    expect(toCsv([entry({ memo: '\t=1+1' })])).toContain('"\'\t=1+1"');
  });

  it('일반 값에는 따옴표를 붙이지 않는다', () => {
    const csv = toCsv([entry({ vendor: '원단상사', memo: '2차 분할' })]);
    expect(csv).toContain('원단상사');
    expect(csv).toContain('2차 분할');
    expect(csv).not.toContain("'");
  });

  it('마이그레이션된 v1 항목도 새 헤더 순서로 나온다', () => {
    const e = normalizeEntry(legacy({ id: 'l1', amount: 42000 }));
    const line = toCsv([e!]).split('\r\n')[1];
    // v1 에는 승인번호가 없으므로 그 열은 빈 채로 나옵니다(추측해서 채우지 않음).
    expect(line).toContain('2026-03-05,매입·원재료,원단상사,,42000,확인 필요,N,확인 필요,카드전표(매출전표),원본 확보,미제출,v1 데이터');
  });
});

describe('표기 헬퍼', () => {
  it('formatKRW 는 원화 천 단위 구분', () => {
    expect(formatKRW(1200000)).toBe('₩1,200,000');
    expect(formatKRW(0)).toBe('₩0');
  });

  it('csvFileName 은 기간·날짜를 포함', () => {
    expect(csvFileName('2026-03')).toMatch(/^execution_202603_\d{8}\.csv$/);
    expect(csvFileName('')).toMatch(/^execution_all_\d{8}\.csv$/);
  });

  it('csvFileName 은 기간 문자를 파일 이름에 안전한 형태로 바꾼다', () => {
    const now = new Date('2026-03-31T12:00:00Z');
    expect(csvFileName('2026-01-01~2026-01-31', now)).toBe('execution_20260101~20260131_20260331.csv');
    expect(csvFileName('from-2026-02-05', now)).toBe('execution_from20260205_20260331.csv');
    // 경로 구분자·점·한글은 파일 이름을 망가뜨리지 못합니다.
    expect(csvFileName('../../암/기', now)).toBe('execution_all_20260331.csv');
    expect(csvFileName('  ', now)).toBe('execution_all_20260331.csv');
    expect(csvFileName('../x', now)).toBe('execution_x_20260331.csv');
  });
});

describe('exportPeriod (필터 기간을 파일 이름으로)', () => {
  const now = new Date('2026-03-31T00:00:00Z');
  it('필터가 없으면 현재 월', () => {
    expect(exportPeriod({}, now)).toBe('2026-03');
  });
  it('시작·종료일이 둘 다 있으면 범위', () => {
    expect(exportPeriod({ from: '2026-01-01', to: '2026-01-31' }, now)).toBe('2026-01-01~2026-01-31');
  });
  it('한쪽만 있으면 그쪽만 적는다', () => {
    expect(exportPeriod({ from: '2026-02-05' }, now)).toBe('from-2026-02-05');
    expect(exportPeriod({ to: '2026-02-05' }, now)).toBe('to-2026-02-05');
  });
  it('다른 필터 값은 파일 이름에 영향을 주지 않는다', () => {
    expect(exportPeriod({ budgetItem: '재료비', q: '택' }, now)).toBe('2026-03');
  });
});

describe('마이그레이션 견고성 (리뷰 지적 재현)', () => {
  const v1 = (over: Record<string, unknown> = {}) => ({
    id: 'l1',
    date: '2026-03-05',
    vendor: '원단상사',
    amount: 42000,
    payMethod: '카드',
    evidenceType: '신용카드매출전표',
    regularEvidence: true,
    category: '매입·원재료',
    memo: 'v1 데이터',
    ...over
  });

  it('두 번 지나가도 결과가 같다(멱등)', () => {
    const once = migrateLegacyEntry(v1());
    const twice = migrateLegacyEntry(structuredClone(once));
    expect(twice).toEqual(once);
    const e1 = normalizeEntry(v1());
    const e2 = normalizeEntry(JSON.parse(JSON.stringify(e1)));
    expect(e2).toEqual(e1);
  });

  it('v1 신호와 v2 값이 섞여 있어도 이미 채워진 v2 필드는 살려 둔다', () => {
    const mixed = normalizeEntry(
      v1({
        payMethod: '전용(체크)카드',
        budgetItem: '시제품 제작',
        periodState: '기간 내',
        submitState: '제출 완료',
        evidenceState: '사본·이미지만'
      })
    );
    expect(mixed!.payMethod).toBe('전용(체크)카드');
    expect(mixed!.budgetItem).toBe('시제품 제작');
    expect(mixed!.periodState).toBe('기간 내');
    expect(mixed!.submitState).toBe('제출 완료');
    expect(mixed!.evidenceState).toBe('사본·이미지만');
  });

  it('category 가 비어 있으면 budgetItem 은 기타로 간다', () => {
    expect(normalizeEntry(v1({ category: '   ' }))!.budgetItem).toBe('기타');
    expect(normalizeEntry(v1({ category: '' }))!.budgetItem).toBe('기타');
  });

  it('__proto__ 같은 키가 들어와도 프로토타입을 건드리지 않는다', () => {
    const bad = normalizeEntry({ date: '2026-03-05', amount: 10, payMethod: '__proto__', category: '재료비' });
    expect(bad!.payMethod).toBe('확인 필요');
    expect(({} as Record<string, unknown>).payMethod).toBeUndefined();
    expect(({} as Record<string, unknown>).evidenceState).toBeUndefined();
  });

  it('v2 만의 값(현금·계좌이체 등)은 옛 매핑에 묶여도 그대로 통과', () => {
    for (const pay of ['현금', '계좌이체', '간편결제', '기타', '사업자·법인카드', '개인카드', '확인 필요']) {
      const e = normalizeEntry({ date: '2026-03-05', amount: 10, payMethod: pay });
      expect(e!.payMethod).toBe(pay);
    }
  });
});
