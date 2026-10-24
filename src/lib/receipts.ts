/**
 * 사업비 집행·지출증빙 정리 도구의 순수 로직.
 * 프레임워크·브라우저에 의존하지 않아 vitest 로 검증됩니다.
 *
 * 이 파일의 어떤 함수도 "이 지출이 인정된다/불인정된다" 를 판정하지 않습니다.
 * 인정 여부·금액선·기한은 사업 공고와 주관기관 지침(및 세법) 사항이라
 * 사이트에서 단정하지 않고, 사용자가 고른 분류를 집계만 합니다.
 */

export const SCHEMA_VERSION = 2;

/** 결제(지출) 경로. v1 의 모호한 '카드' 값은 마이그레이션에서 '확인 필요' 로 보정됩니다. */
export const PAY_METHODS = [
  '전용(체크)카드',
  '사업자·법인카드',
  '개인카드',
  '현금',
  '계좌이체',
  '간편결제',
  '기타',
  '확인 필요'
] as const;
export type PayMethod = (typeof PAY_METHODS)[number];

/** v1 → v2 결제수단 매핑 */
export const LEGACY_PAY_MAP: Record<string, PayMethod> = {
  카드: '확인 필요',
  현금: '현금',
  계좌이체: '계좌이체',
  간편결제: '간편결제',
  기타: '기타'
};

/** 수취한 서류의 종류 (세무 일반 용어이며, 정산 인정 여부와는 별개입니다) */
export const EVIDENCE_TYPES = [
  '세금계산서',
  '계산서',
  '현금영수증',
  '카드전표(매출전표)',
  '간이영수증',
  '계약서·견적서만',
  '없음'
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

/** 서류를 얼마나 갖췄는지. 정산 준비 상태에서 가장 실적인 필드입니다. */
export const EVIDENCE_STATES = ['원본 확보', '사본·이미지만', '미수취', '재요청함'] as const;
export type EvidenceState = (typeof EVIDENCE_STATES)[number];

/** 사업(집행) 기간 안/밖. 기간 외 지출이 문제되므로 기간 필드를 따로 둡니다. */
export const PERIOD_STATES = ['기간 내', '기간 외', '확인 필요'] as const;
export type PeriodState = (typeof PERIOD_STATES)[number];

/** 정산 제출 상태 */
export const SUBMIT_STATES = ['미제출', '초안 포함', '제출 완료', '보완 요청'] as const;
export type SubmitState = (typeof SUBMIT_STATES)[number];

/**
 * 비목(예산과목) 예시. 사업·주관기관마다 배목 체계가 다르므로
 * 입력창은 예시 목록 + 자유 입력(datalist) 으로 두고, 여기서 정하는 것은 기본값뿐입니다.
 */
export const CATEGORY_SUGGESTIONS = [
  '인건비',
  '시제품 제작',
  '시험·검사·인증',
  '지식재산(IP)',
  '광고·마케팅',
  '전시·박람회',
  '외주·위탁',
  '장비·기구 임차',
  '재료비',
  '사무·운영',
  '출장·교통',
  '기타'
] as const;

export interface ReceiptEntry {
  id: string;
  /** YYYY-MM-DD (지출일) */
  date: string;
  vendor: string;
  amount: number;
  budgetItem: string;
  payMethod: PayMethod;
  evidenceType: EvidenceType;
  evidenceState: EvidenceState;
  periodState: PeriodState;
  submitState: SubmitState;
  memo: string;
}

export interface Filters {
  from?: string;
  to?: string;
  budgetItem?: string;
  evidenceType?: string;
  evidenceState?: string;
  periodState?: string;
  submitState?: string;
  payMethod?: string;
  q?: string;
}

export function makeId(now: number = Date.now()): string {
  return `r${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function oneOf<T extends readonly string[]>(value: unknown, list: T, fallback: T[number]): T[number] {
  return list.includes(value as T[number]) ? (value as T[number]) : fallback;
}

/**
 * v1 항목(카드/현금 5종 + 정규증빙 구분 + 카테고리)을 v2 형태로 끌어올립니다.
 *
 * v1 과 v2 가 같은 단어로 쓰는 결제경로(현금·계좌이체·간편결제·기타)가 있으므로,
 * '카드' 라는 옛 값이나 v1 전용 필드(category·regularEvidence)가 보일 때만 승격합니다.
 * v2 필드가 이미 있으면 건드리지 않아, 같은 항목을 여러 번 지나가도 결과가 바뀌지 않습니다.
 */
export function migrateLegacyEntry(raw: Record<string, unknown>): Record<string, unknown> {
  const pay = typeof raw.payMethod === 'string' ? raw.payMethod : '';
  const hasV1Shape = pay === '카드' || typeof raw.category === 'string' || 'regularEvidence' in raw;
  if (!hasV1Shape) return raw;
  const evidence = typeof raw.evidenceType === 'string' ? raw.evidenceType : '없음';
  const movedEvidence = evidence === '신용카드매출전표' ? '카드전표(매출전표)' : evidence === '기타영수증' ? '간이영수증' : evidence;
  const keep = (key: string, fallback: string) => (typeof raw[key] === 'string' && raw[key] !== '' ? (raw[key] as string) : fallback);
  return {
    ...raw,
    budgetItem: keep('budgetItem', typeof raw.category === 'string' && raw.category ? raw.category : '기타'),
    payMethod: LEGACY_PAY_MAP[pay] ?? '확인 필요',
    evidenceType: movedEvidence,
    evidenceState: keep('evidenceState', evidence === '없음' ? '미수취' : '원본 확보'),
    periodState: keep('periodState', '확인 필요'),
    submitState: keep('submitState', '미제출')
  };
}

export function normalizeEntry(raw: unknown): ReceiptEntry | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = migrateLegacyEntry(raw as Record<string, unknown>);
  const date = typeof o.date === 'string' ? o.date.slice(0, 10) : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const amount = Number(o.amount);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return {
    id: typeof o.id === 'string' && o.id ? o.id : makeId(),
    date,
    vendor: typeof o.vendor === 'string' ? o.vendor.trim() : '',
    amount: Math.round(amount),
    budgetItem: typeof o.budgetItem === 'string' && o.budgetItem.trim() ? o.budgetItem.trim() : '기타',
    payMethod: oneOf(o.payMethod, PAY_METHODS, '확인 필요'),
    evidenceType: oneOf(o.evidenceType, EVIDENCE_TYPES, '없음'),
    evidenceState: oneOf(o.evidenceState, EVIDENCE_STATES, '미수취'),
    periodState: oneOf(o.periodState, PERIOD_STATES, '확인 필요'),
    submitState: oneOf(o.submitState, SUBMIT_STATES, '미제출'),
    memo: typeof o.memo === 'string' ? o.memo : ''
  };
}

/** 항목이 없거나 날짜·금액이 틀린 행을 걸러냅니다. 입력 순서는 보존됩니다. */
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
    if (f.budgetItem && e.budgetItem !== f.budgetItem) return false;
    if (f.evidenceType && e.evidenceType !== f.evidenceType) return false;
    if (f.evidenceState && e.evidenceState !== f.evidenceState) return false;
    if (f.periodState && e.periodState !== f.periodState) return false;
    if (f.submitState && e.submitState !== f.submitState) return false;
    if (f.payMethod && e.payMethod !== f.payMethod) return false;
    if (q) {
      const hay = `${e.vendor} ${e.memo} ${e.budgetItem}`.toLowerCase();
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
  /** 전용(체크)카드로 결제했다고 표시한 금액과 비율(0~100) */
  dedicatedTotal: number;
  dedicatedRate: number;
  /** 증빙을 아직 못 갖췄거나 재요청 중인 건 */
  evidenceGapCount: number;
  evidenceGapTotal: number;
  /** 집행 기간 밖이거나 기간 확인이 안 된 건 */
  periodRiskCount: number;
  periodRiskTotal: number;
  /** 정산 제출이 아직 안 된 건 (제출 완료 제외) */
  notSubmittedCount: number;
  notSubmittedTotal: number;
  byBudgetItem: Group[];
  byEvidenceType: Group[];
  byPayMethod: Group[];
  /** YYYY-MM 오름차순 */
  byMonth: Group[];
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

const sum = (list: ReceiptEntry[]) => list.reduce((s, e) => s + e.amount, 0);

export function computeTotals(entries: ReceiptEntry[]): Totals {
  const total = sum(entries);
  const dedicated = entries.filter((e) => e.payMethod === '전용(체크)카드');
  const gap = entries.filter((e) => e.evidenceState === '미수취' || e.evidenceState === '재요청함');
  const periodRisk = entries.filter((e) => e.periodState === '기간 외' || e.periodState === '확인 필요');
  const notSubmitted = entries.filter((e) => e.submitState !== '제출 완료');
  const rate = (part: number) => (total > 0 ? Math.round((part / total) * 100) : 0);
  const dedicatedTotal = sum(dedicated);
  const gapTotal = sum(gap);
  const riskTotal = sum(periodRisk);
  const unsentTotal = sum(notSubmitted);
  return {
    count: entries.length,
    total,
    dedicatedTotal,
    dedicatedRate: rate(dedicatedTotal),
    evidenceGapCount: gap.length,
    evidenceGapTotal: gapTotal,
    periodRiskCount: periodRisk.length,
    periodRiskTotal: riskTotal,
    notSubmittedCount: notSubmitted.length,
    notSubmittedTotal: unsentTotal,
    byBudgetItem: groupBy(entries, (e) => e.budgetItem).sort((a, b) => b.total - a.total),
    byEvidenceType: groupBy(entries, (e) => e.evidenceType),
    byPayMethod: groupBy(entries, (e) => e.payMethod),
    byMonth: groupBy(entries, (e) => e.date.slice(0, 7)).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  };
}

/** 미수취·재요청 항목만 뽑아 재발행 요청 목록으로 쓰기 위한 정렬 */
export function evidenceGapList(entries: ReceiptEntry[]): ReceiptEntry[] {
  return entries
    .filter((e) => e.evidenceState === '미수취' || e.evidenceState === '재요청함')
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export const CSV_HEADER = [
  '지출일',
  '비목(예산과목)',
  '거래처',
  '금액',
  '결제경로',
  '전용카드',
  '집행기간',
  '증빙종류',
  '수취상태',
  '제출상태',
  '메모'
] as const;

export const CSV_COLUMN_COUNT = CSV_HEADER.length;

function csvCell(value: string | number): string {
  const s = String(value ?? '');
  // 따옴표·쉼표·개행·앞뒤 공백, 그리고 수식으로 해석될 여지는 인용 부호로 무력화합니다.
  if (/^[=+\-@\t\r]/.test(s) || /[",\n\r]/.test(s) || s !== s.trim()) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsvRows(entries: ReceiptEntry[]): string[][] {
  return entries.map((e) => [
    e.date,
    e.budgetItem,
    e.vendor,
    String(e.amount),
    e.payMethod,
    e.payMethod === '전용(체크)카드' ? 'Y' : 'N',
    e.periodState,
    e.evidenceType,
    e.evidenceState,
    e.submitState,
    e.memo
  ]);
}

/** 줄구분 CRLF, BOM 없는 원문. BOM 부착은 toCsvFile 에서 합니다. */
export function toCsv(entries: ReceiptEntry[]): string {
  const lines = [CSV_HEADER.map(csvCell).join(','), ...toCsvRows(entries).map((r) => r.map(csvCell).join(','))];
  return lines.join('\r\n');
}

export const CSV_BOM = '﻿';

/** 한글 Windows·macOS Excel 이 UTF-8 를 인식하도록 BOM 을 붙입니다. */
export function toCsvFile(entries: ReceiptEntry[]): string {
  return CSV_BOM + toCsv(entries);
}

export function csvFileName(period: string): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `execution_${period.replace(/-/g, '') || 'all'}_${stamp}.csv`;
}

export function formatKRW(n: number): string {
  return `₩${Math.round(n).toLocaleString('ko-KR')}`;
}

export function currentPeriod(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}
