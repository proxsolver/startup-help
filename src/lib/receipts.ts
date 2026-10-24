/**
 * 사업비 집행·지출증빙 정리 도구의 순수 로직.
 * 프레임워크·브라우저에 의존하지 않아 vitest 로 검증됩니다.
 *
 * 이 파일의 어떤 함수도 "이 지출이 인정된다/불인정된다" 를 판정하지 않습니다.
 * 인정 여부·금액선·기한은 사업 공고와 주관기관 지침(및 세법) 사항이라
 * 사이트에서 단정하지 않고, 사용자가 고른 분류를 집계만 합니다.
 */

/**
 * 저장본(localStorage) 형식 표식. 올리는 이유는 강등 방지를 위해서입니다:
 * 이 값보다 큰 저장본을 만난 코드는 쓰기를 거부합니다(storage.ts 의 isFutureSchema).
 *   1 → 2 : 집행기간·수취상태·제출상태·비목 항목 체계 도입
 *   2 → 3 : 삭제 기록(removed)과 복원 세대(restoreAt) 필드 도입 — 예전 번들이 그 두 칸을
 *           조용히 지우면 지운 행이 되살아나고 남의 복원을 덮어씁니다. 그래서 아예 쓰기를 막습니다.
 */
export const SCHEMA_VERSION = 3;

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

const isPayMethod = (v: unknown) => (PAY_METHODS as readonly string[]).includes(v as string);

/**
 * v1 항목(카드/현금 5종 + 정규증빙 구분 + 카테고리)을 v2 형태로 끌어올립니다.
 *
 * 규칙:
 * - v1 신호는 '카드' 값, `category` 필드, `regularEvidence` 키가 있을 때만 인정합니다
 *   (현금·계좌이체·간편결제·기타 는 v1과 v2가 같은 단어를 씁니다).
 * - **이미 채워진 v2 필드는 절대 덮어쓰지 않습니다.** 옛 백업 파일을 v2 화면에서 다시
 *   내보낸 뒤 복원하는 것처럼 두 체계가 섞인 항목이 들어와도 전용카드·집행기간·제출상태가
 *   사라지지 않습니다.
 * - 같은 항목을 여러 번 지나가도 결과가 같은 그대로입니다(멱등).
 */
export function migrateLegacyEntry(raw: Record<string, unknown>): Record<string, unknown> {
  const pay = typeof raw.payMethod === 'string' ? raw.payMethod : '';
  const hasV1Shape = pay === '카드' || typeof raw.category === 'string' || Object.hasOwn(raw, 'regularEvidence');
  if (!hasV1Shape) return raw;

  const out: Record<string, unknown> = { ...raw };
  const filled = (key: string) => typeof raw[key] === 'string' && (raw[key] as string).trim() !== '';

  if (!filled('budgetItem')) {
    out.budgetItem = typeof raw.category === 'string' && raw.category ? raw.category : '기타';
  }
  if (!isPayMethod(pay)) {
    out.payMethod = Object.hasOwn(LEGACY_PAY_MAP, pay) ? LEGACY_PAY_MAP[pay] : '확인 필요';
  }
  const evidence = typeof raw.evidenceType === 'string' ? raw.evidenceType : '없음';
  out.evidenceType =
    evidence === '신용카드매출전표' ? '카드전표(매출전표)' : evidence === '기타영수증' ? '간이영수증' : evidence;
  if (!filled('evidenceState')) out.evidenceState = evidence === '없음' ? '미수취' : '원본 확보';
  if (!filled('periodState')) out.periodState = '확인 필요';
  if (!filled('submitState')) out.submitState = '미제출';
  return out;
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

/** 앞의 공백(탭·개행·붙여쓰기 공백)을 건너뛴 첫 글자가 `= + - @` 면 수식으로 계산될 여지가 있습니다. */
const FORMULA_LIKE = /^\s*[=+\-@]/;

/**
 * CSV 셀 하나를 만들어 붙입니다. 두 가지를 따로 막습니다.
 *
 * 1) 쉼표·따옴표·개행·앞뒤 공백 → 인용 부호로 감싸서 열이 어긋나는 것을 막습니다.
 * 2) 수식으로 시작할 여지(`= + - @`) → 셀 앞에 작은따옴표를 붙여 **텍스트로 고정**합니다.
 *    인용 부호만으로는 엑셀·구글시트가 `"=WEBSERVICE(...)"` 를 계산하는 것을 막지 못합니다.
 *    이 파일을 정산 담당자·검증자 컴퓨터에서 여는 순간 자기 PC에서만 끝나지 않기 때문에,
 *    값을 지우거나 바꿔치기하지 않고 눈에 보이는 접두 하나만 남기는 방식을 택했습니다.
 *    (CSV 를 다시 읽어들이는 길은 이 사이트에 없습니다 — 복원은 JSON 백업만 받습니다.)
 */
function csvCell(value: string | number): string {
  const s = String(value ?? '');
  const out = FORMULA_LIKE.test(s) ? `'${s}` : s;
  // 따옴표·쉼표·개행·앞뒤 공백, 그리고 수식 접두를 붙인 셀은 인용 부호로 감쌉니다.
  if (/^[=+\-@\t\r]/.test(s) || /[",\n\r]/.test(s) || s !== s.trim()) return `"${out.replace(/"/g, '""')}"`;
  return out;
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

/**
 * CSV 파일 이름에 쓸 기간 표기.
 * 화면의 필터(from/to)가 파일 이름에도 반영되어야, 받아둔 파일이 "언제 범위" 인지 붙입니다.
 * 필터가 없으면 현재 월, 한쪽만 있으면 그쪽만 적습니다.
 */
export function exportPeriod(f: Filters = {}, now: Date = new Date()): string {
  const from = typeof f.from === 'string' ? f.from.slice(0, 10) : '';
  const to = typeof f.to === 'string' ? f.to.slice(0, 10) : '';
  if (from && to) return `${from}~${to}`;
  if (from) return `from-${from}`;
  if (to) return `to-${to}`;
  return currentPeriod(now);
}

export function csvFileName(period: string, now: Date = new Date()): string {
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  // 파일 이름을 망가뜨릴 수 있는 문자(경로 구분자·점·한글 등)는 모두 지운 뒤 비어 있으면 all 로 갑니다.
  const safe = (period || 'all')
    .replace(/[^0-9A-Za-z_~]/g, '_')
    .replace(/^[_~]+|[_~]+$/g, '')
    .replace(/_/g, '');
  return `execution_${safe || 'all'}_${stamp}.csv`;
}

export function formatKRW(n: number): string {
  return `₩${Math.round(n).toLocaleString('ko-KR')}`;
}

export function currentPeriod(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}
