/**
 * 영수증 정리 도구의 순수 로직.
 * 프레임워크·브라우저에 의존하지 않아 vitest 로 바로 검증할 수 있습니다.
 *
 * 이 파일의 어떤 함수도 "이 지출이 경비로 인정된다" 를 판정하지 않습니다.
 * 인정 여부·한도·기한은 세법 사항이라 사이트에서 단정하지 않고,
 * 정규 증빙 여부(사용자가 직접 선택하는 분류)만 다룹니다.
 */

export const PAY_METHODS = ['카드', '현금', '계좌이체', '간편결제', '기타'] as const;
export type PayMethod = (typeof PAY_METHODS)[number];

/** 정규 증빙으로 널리 취급되는 4종 + 그 외 + 없음 */
export const EVIDENCE_TYPES = [
  '세금계산서',
  '계산서',
  '현금영수증',
  '신용카드매출전표',
  '기타영수증',
  '없음'
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

/** 정규 증빙으로 분류하는 키. 집계에 쓰이고, 법적 효력을 단정하지 않습니다. */
export const REGULAR_EVIDENCE: readonly EvidenceType[] = [
  '세금계산서',
  '계산서',
  '현금영수증',
  '신용카드매출전표'
];

export const CATEGORIES = [
  '매입·원재료',
  '임차료·관리비',
  '통신·인터넷',
  '광고·마케팅',
  '교통·출장',
  '식대·접대',
  '인건비',
  '소프트웨어·클라우드',
  '금융·수수료',
  '세무·법무',
  '사무용품',
  '기타'
] as const;
export type Category = (typeof CATEGORIES)[number] | string;

export interface ReceiptEntry {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  vendor: string;
  amount: number;
  payMethod: PayMethod;
  evidenceType: EvidenceType;
  category: Category;
  memo: string;
}

export interface Filters {
  from?: string;
  to?: string;
  category?: string;
  evidenceType?: string;
  q?: string;
}

export const SCHEMA_VERSION = 1;

export function makeId(now: number = Date.now()): string {
  return `r${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function isRegularEvidence(type: EvidenceType): boolean {
  return REGULAR_EVIDENCE.includes(type);
}

export function normalizeEntry(raw: unknown): ReceiptEntry | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const date = typeof o.date === 'string' ? o.date.slice(0, 10) : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const amount = Number(o.amount);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const vendor = typeof o.vendor === 'string' ? o.vendor.trim() : '';
  const evidenceType = EVIDENCE_TYPES.includes(o.evidenceType as EvidenceType)
    ? (o.evidenceType as EvidenceType)
    : '없음';
  const payMethod = PAY_METHODS.includes(o.payMethod as PayMethod)
    ? (o.payMethod as PayMethod)
    : '기타';
  return {
    id: typeof o.id === 'string' && o.id ? o.id : makeId(),
    date,
    vendor,
    amount: Math.round(amount),
    payMethod,
    evidenceType,
    category: typeof o.category === 'string' && o.category ? o.category : '기타',
    memo: typeof o.memo === 'string' ? o.memo : ''
  };
}

/** 항목이 없거나 날짜 형식이 틀린 행을 걸러낸 뒤, 입력 순서를 보존해 반환합니다. */
export function sanitizeEntries(raw: unknown): ReceiptEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ReceiptEntry[] = [];
  for (const row of raw) {
    const e = normalizeEntry(row);
    if (e) out.push(e);
  }
  return out;
}

export function filterEntries(entries: ReceiptEntry[], f: Filters = {}): ReceiptEntry[] {
  const q = (f.q ?? '').trim().toLowerCase();
  return entries.filter((e) => {
    if (f.from && e.date < f.from) return false;
    if (f.to && e.date > f.to) return false;
    if (f.category && e.category !== f.category) return false;
    if (f.evidenceType && e.evidenceType !== f.evidenceType) return false;
    if (q) {
      const hay = `${e.vendor} ${e.memo} ${e.category}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export interface Group {
  key: string;
  count: number;
  total: number;
}

export interface Totals {
  count: number;
  total: number;
  regularTotal: number;
  /** 정규 증빙 금액 비율(0~100). 반올림 정수는 total 이 0 이상일 때만 의미가 있습니다. */
  regularRate: number;
  byCategory: Group[];
  byEvidence: Group[];
  /** YYYY-MM 오름차순 */
  byMonth: Group[];
  missingEvidence: number;
}

function groupBy(entries: ReceiptEntry[], keyOf: (e: ReceiptEntry) => string): Group[] {
  const map = new Map<string, Group>();
  for (const e of entries) {
    const key = keyOf(e);
    const g = map.get(key) ?? { key, count: 0, total: 0 };
    g.count += 1;
    g.total += e.amount;
    map.set(key, g);
  }
  return [...map.values()];
}

export function computeTotals(entries: ReceiptEntry[]): Totals {
  const total = entries.reduce((s, e) => s + e.amount, 0);
  const regularTotal = entries
    .filter((e) => isRegularEvidence(e.evidenceType))
    .reduce((s, e) => s + e.amount, 0);
  return {
    count: entries.length,
    total,
    regularTotal,
    regularRate: total > 0 ? Math.round((regularTotal / total) * 100) : 0,
    byCategory: groupBy(entries, (e) => e.category).sort((a, b) => b.total - a.total),
    byEvidence: groupBy(entries, (e) => e.evidenceType),
    byMonth: groupBy(entries, (e) => e.date.slice(0, 7)).sort((a, b) =>
      a.key < b.key ? -1 : a.key > b.key ? 1 : 0
    ),
    missingEvidence: entries.filter((e) => e.evidenceType === '없음').length
  };
}

export const CSV_HEADER = [
  '날짜',
  '공급가액수령처',
  '금액',
  '결제수단',
  '증빙구분',
  '정규증빙',
  '분류',
  '메모'
] as const;

function csvCell(value: string | number): string {
  const s = String(value ?? '');
  // 따옴표·쉼표·개행·앞뒤 공백은 인용 부호로 감쌉니다. 앞쪽 공백은 Excel 이 셀 타입을 바꿔놓습니다.
  if (/[",\n\r]/.test(s) || s !== s.trim()) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsvRows(entries: ReceiptEntry[]): string[][] {
  return entries.map((e) => [
    e.date,
    e.vendor,
    String(e.amount),
    e.payMethod,
    e.evidenceType,
    isRegularEvidence(e.evidenceType) ? 'Y' : 'N',
    e.category,
    e.memo
  ]);
}

/**
 * 줄구분은 CRLF, 앞에 BOM 을 붙이지 않은 원본 문자열을 반환합니다.
 * BOM 부착은 export 파일 생성 단계(toCsvFile)에서 합니다.
 */
export function toCsv(entries: ReceiptEntry[]): string {
  const lines = [CSV_HEADER.map(csvCell).join(','), ...toCsvRows(entries).map((r) => r.map(csvCell).join(','))];
  return lines.join('\r\n');
}

export const CSV_BOM = '﻿';

export function toCsvFile(entries: ReceiptEntry[]): string {
  return CSV_BOM + toCsv(entries);
}

/** 한글 Windows Excel 이 UTF-8 를 바로 잡도록 BOM 을 요구합니다. */
export function csvFileName(period: string): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `receipts_${period.replace(/-/g, '') || 'all'}_${stamp}.csv`;
}

export function formatKRW(n: number): string {
  return `₩${Math.round(n).toLocaleString('ko-KR')}`;
}

export function currentPeriod(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}
