import { describe, expect, it } from 'vitest';
import {
  CSV_BOM,
  REGULAR_EVIDENCE,
  computeTotals,
  csvFileName,
  filterEntries,
  formatKRW,
  isRegularEvidence,
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
    amount: 120000,
    payMethod: '카드',
    evidenceType: '신용카드매출전표',
    category: '매입·원재료',
    memo: '',
    ...over
  };
}

describe('normalizeEntry / sanitizeEntries', () => {
  it('유효한 입력을 그대로 받아들이고 금액을 반올림한다', () => {
    const e = normalizeEntry({ date: '2026-03-05', vendor: '  A  ', amount: 1004.6, evidenceType: '현금영수증', payMethod: '현금', category: '기타' });
    expect(e?.amount).toBe(1005);
    expect(e?.vendor).toBe('A');
    expect(e?.id).toBeTruthy();
  });

  it('날짜 형식·금액 오류는 항목을 버린다', () => {
    expect(normalizeEntry({ date: '2026-3-5', amount: 100 })).toBeNull();
    expect(normalizeEntry({ date: '2026-03-05', amount: -5 })).toBeNull();
    expect(normalizeEntry({ date: '2026-03-05', amount: NaN })).toBeNull();
    expect(normalizeEntry(null)).toBeNull();
    expect(normalizeEntry('nope')).toBeNull();
  });

  it('알 수 없는 증빙·결제 값은 안전한 기본값으로 바꾼다', () => {
    const e = normalizeEntry({ date: '2026-03-05', amount: 10, evidenceType: '따따블', payMethod: '코인' });
    expect(e?.evidenceType).toBe('없음');
    expect(e?.payMethod).toBe('기타');
  });

  it('배열이 아니면 빈 목록, 일부 오류 행만 걸러낸다', () => {
    expect(sanitizeEntries(undefined)).toEqual([]);
    expect(sanitizeEntries('x')).toEqual([]);
    const ok = sanitizeEntries([entry(), { date: 'x', amount: 1 }, entry({ id: 'x2', amount: 5000 })]);
    expect(ok).toHaveLength(2);
  });
});

describe('isRegularEvidence', () => {
  it('정규 증빙 4종만 true', () => {
    expect(REGULAR_EVIDENCE).toHaveLength(4);
    for (const t of REGULAR_EVIDENCE) expect(isRegularEvidence(t)).toBe(true);
    expect(isRegularEvidence('기타영수증')).toBe(false);
    expect(isRegularEvidence('없음')).toBe(false);
  });
});

describe('filterEntries', () => {
  const list = [
    entry({ id: 'a', date: '2026-03-01', amount: 1000, category: '통신·인터넷', vendor: '통신사' }),
    entry({ id: 'b', date: '2026-03-20', amount: 2000, category: '교통·출장', evidenceType: '없음', memo: '택배비' }),
    entry({ id: 'c', date: '2026-04-02', amount: 3000, category: '통신·인터넷' })
  ];

  it('시작일·종료일은 경계를 포함해 자른다', () => {
    expect(filterEntries(list, { from: '2026-03-01', to: '2026-03-20' }).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('분류·증빙 필터', () => {
    expect(filterEntries(list, { category: '통신·인터넷' }).map((e) => e.id)).toEqual(['a', 'c']);
    expect(filterEntries(list, { evidenceType: '없음' }).map((e) => e.id)).toEqual(['b']);
  });

  it('검색어는 거래처·메모·분류를 대소문자 없이 본다', () => {
    expect(filterEntries(list, { q: '택배' }).map((e) => e.id)).toEqual(['b']);
    expect(filterEntries(list, { q: '  택 배  '.replace(/\s+/g, '') }).map((e) => e.id)).toEqual(['b']);
    expect(filterEntries(list, { q: '없는단어' })).toEqual([]);
  });

  it('필터 없음은 전체', () => {
    expect(filterEntries(list)).toHaveLength(3);
  });
});

describe('computeTotals', () => {
  it('합계·정규 증빙 비율·그룹별 집계', () => {
    const totals = computeTotals([
      entry({ id: 'a', amount: 70000, evidenceType: '현금영수증', category: '통신·인터넷', date: '2026-03-02' }),
      entry({ id: 'b', amount: 20000, evidenceType: '기타영수증', category: '통신·인터넷', date: '2026-04-09' }),
      entry({ id: 'c', amount: 10000, evidenceType: '없음', category: '기타', date: '2026-03-30' })
    ]);
    expect(totals.total).toBe(100000);
    expect(totals.count).toBe(3);
    expect(totals.regularTotal).toBe(70000);
    expect(totals.regularRate).toBe(70);
    expect(totals.missingEvidence).toBe(1);
    expect(totals.byCategory.find((g) => g.key === '통신·인터넷')).toEqual({ key: '통신·인터넷', count: 2, total: 90000 });
    expect(totals.byMonth.map((g) => g.key)).toEqual(['2026-03', '2026-04']);
  });

  it('빈 목록에서 0 과 0% 를 돌려주고 0으로 나누지 않는다', () => {
    const t = computeTotals([]);
    expect(t.total).toBe(0);
    expect(t.regularRate).toBe(0);
    expect(t.byCategory).toEqual([]);
    expect(t.byMonth).toEqual([]);
  });

  it('byCategory 는 금액 내림차순', () => {
    const t = computeTotals([
      entry({ id: 'a', amount: 100, category: '기타' }),
      entry({ id: 'b', amount: 900, category: '임차료·관리비' }),
      entry({ id: 'c', amount: 400, category: '광고·마케팅' })
    ]);
    expect(t.byCategory.map((g) => g.key)).toEqual(['임차료·관리비', '광고·마케팅', '기타']);
  });
});

describe('CSV 내보내기', () => {
  it('CRLF 줄구분, 헤더 8열, BOM 은 파일 생성 단계에서만 붙는다', () => {
    const csv = toCsv([entry({ amount: 1500 })]);
    expect(csv).not.toContain(CSV_BOM);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0].split(',')).toHaveLength(8);
    expect(lines[0]).toContain('정규증빙');
    expect(toCsvFile([entry()]).charCodeAt(0)).toBe(0xfeff);
  });

  it('정규 증빙 여부는 Y/N 으로 표시', () => {
    expect(toCsv([entry({ evidenceType: '세금계산서' })])).toContain(',Y,');
    expect(toCsv([entry({ evidenceType: '기타영수증' })])).toContain(',N,');
  });

  it('쉼표·따옴표·개행·앞뒤 공백을 인용부호로 감싼다 (CSV 인젝션 방지 포함)', () => {
    const csv = toCsv([entry({ vendor: 'A,B', memo: 'say "hi"' })]);
    expect(csv).toContain('"A,B"');
    expect(csv).toContain('"say ""hi"""');
  });

  it('수식으로 해석될 수 있는 값은 인용부호로 감싼다', () => {
    const csv = toCsv([entry({ vendor: ' =SUM(A1)' })]);
    expect(csv).toContain('" =SUM(A1)"');
  });
});

describe('표기 헬퍼', () => {
  it('formatKRW 는 원화 천 단위 구분', () => {
    expect(formatKRW(1200000)).toBe('₩1,200,000');
    expect(formatKRW(0)).toBe('₩0');
  });

  it('csvFileName 은 기간·날짜를 포함', () => {
    expect(csvFileName('2026-03')).toMatch(/^receipts_202603_\d{8}\.csv$/);
    expect(csvFileName('')).toMatch(/^receipts_all_\d{8}\.csv$/);
  });
});
