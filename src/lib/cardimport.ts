/**
 * 카드사에서 받은 파일을 집행 기록으로 바꾸는 순수 로직 (서버·외부 라이브러리 없음).
 *
 * .xlsx 는 zip이라서 풀어야 하는데, JSZip 같은 패키지를 안 넣는 대신 **브라우저가 이미 가진
 * DecompressionStream('deflate-raw')** 을 씁니다(Chrome 103 · Safari 16.4 · Firefox 113 이후, node 18에서도 동작).
 * zip 중앙디렉토리를 직접 읽고, 필요한 항목만 펼친 뒤 XML을 훑습니다.
 * CSV/TSV는 TextDecoder 로 UTF-8(BOM) → EUC-KR 순서로 시도합니다(엑셀 'CSV로 저장'은 EUC-KR로 나옴).
 *
 * 원리 — **양식이 알려 주는 것만 적고, 알려 주지 않은 것은 비워 둡니다.**
 *  지출일·거래처·금액·승인번호는 파일에 있습니다. 그런데 어느 카드가 「전용(체크)카드」인지,
 *  어느 예산과목으로 볼 것인지, 협약 집행기간 안인지는 파일에 없습니다. 그래서 비어 있는 칸은
 *  임의 추측(후불 → 개인카드 같은)을 하지 않고 `확인 필요` 로 남기고, 그 목록을 `gaps` 로 돌려줍니다.
 *  증빙종류는 카드전표로 두지만 수취상태는 **미수취** 가 기본입니다 — 명세서 자체가 전표 파일이 아니라서
 *  '원본 확보' 라고 자동 우기면 정산에서 가장 아픈 구멍을 이 사이트가 덮게 됩니다.
 */
import { MAX_APPROVAL_CHARS, type ReceiptEntry } from './receipts';

export type CardField =
  | 'date'
  | 'cardKind'
  | 'cardLabel'
  | 'vendor'
  | 'industry'
  | 'approvalNo'
  | 'amount'
  | 'acquireState'
  | 'usageKind'
  | 'currency'
  | 'firstPayDate'
  | 'overseasAmount'
  | 'cancelState';

/** 열 이름을 규범화한 뒤 매핑합니다. 카드사·기관마다 표기가 조금씩 다릅니다. */
const COLUMN_ALIASES: Record<CardField, string[]> = {
  date: ['거래일', '이용일', '결제일', '승인일시', '거래일시', '일자'],
  cardKind: ['카드구분', '카드종류', '결제구분'],
  cardLabel: ['이용카드', '카드번호', '카드명', '카드', '결제카드'],
  vendor: ['가맹점명', '가맹점', '점포명', '상호', '업소명', '거래처'],
  industry: ['업종', '업태', '가맹점업종'],
  approvalNo: ['승인번호', '승인일번호', '조회번호', '영수번호'],
  amount: ['금액', '이용금액', '결제금액', '승인금액', '출금금액'],
  acquireState: ['매입구분', '매입상태'],
  usageKind: ['이용구분', '할부구분', '결제방식'],
  currency: ['거래통화', '통화'],
  firstPayDate: ['최초결제일자', '결제예정일', '첫결제일'],
  overseasAmount: ['해외이용금액', '해외금액'],
  cancelState: ['취소상태', '취소구분', '반품여부']
};

/** 공백·괄호 안 단위·문구표·대소문자를 없애 열 이름을 비교 가능하게 만듭니다. */
export function normalizeHeader(raw: string): string {
  return (raw ?? '')
    .replace(/[\s\u00a0]+/g, '')
    // `금액(원)` · `승인번호(6)` 는 덩어리째 버립니다. 문자만 지우면 `금액원` 이 되어 별칭표에 안 붙고
    // 그 열은 '인식 못 한 열' 로 분류돼 값이 조용히 사라집니다. 닫는 괄호가 없는 헤더도 같은 규칙으로 자릅니다.
    .replace(/[([{\uFF08\u3010].*$/, '')
    .replace(/[\u00B7\uFF0E.,:)\]\uFF09]/g, '')
    .toLowerCase();
}

const HEADER_LOOKUP: Map<string, CardField> = (() => {
  const m = new Map<string, CardField>();
  (Object.keys(COLUMN_ALIASES) as CardField[]).forEach((field) => {
    for (const alias of COLUMN_ALIASES[field]) m.set(normalizeHeader(alias), field);
  });
  return m;
})();

export interface ColumnPlan {
  /** grid 열 번호 → CardField (인식 못 하면 null) */
  fields: (CardField | null)[];
  /** 인식하지 못한 열 이름 (사용자에게 알려야 합니다) */
  unknown: string[];
  /** 파일에서 찾지 못한 필수 열 이름 */
  missing: CardField[];
}

/** 표 헤더 행으로 열 매핑을 만듭니다. */
export function detectColumns(headerRow: string[]): ColumnPlan {
  const fields: (CardField | null)[] = [];
  const unknown: string[] = [];
  const used = new Set<CardField>();
  for (const cell of headerRow) {
    const hit = HEADER_LOOKUP.get(normalizeHeader(cell));
    if (hit && !used.has(hit)) {
      fields.push(hit);
      used.add(hit);
    } else {
      fields.push(null);
      if (cell && cell.trim() !== '') unknown.push(cell.trim());
    }
  }
  const missing = (['date', 'vendor', 'amount'] as CardField[]).filter((f) => !used.has(f));
  return { fields, unknown, missing };
}

/** grid 를 { 열이름 → 값 } 행으로 바꿉니다. 헤더를 못 읽은 파일은 여기서 걸러집니다. */
export function rowsFromGrid(grid: string[][]): { headers: string[]; rows: Record<CardField, string>[]; plan: ColumnPlan } | null {
  const firstNonEmpty = grid.find((r) => r.some((c) => (c ?? '').trim() !== ''));
  if (!firstNonEmpty) return null;
  const plan = detectColumns(firstNonEmpty);
  if (plan.missing.length > 0) return null;
  const rows: Record<CardField, string>[] = [];
  for (const line of grid.slice(grid.indexOf(firstNonEmpty) + 1)) {
    const row = {} as Record<CardField, string>;
    let touched = false;
    plan.fields.forEach((field, i) => {
      if (!field) return;
      const v = (line[i] ?? '').trim();
      if (v !== '') {
        row[field] = v;
        touched = true;
      }
    });
    if (touched) rows.push(row);
  }
  return { headers: firstNonEmpty.map((h) => (h ?? '').trim()), rows, plan };
}

/** `총 1건` 같은 합계·머릿글 행입니다. 집행 행으로 보면 금액이 두 배로 부풀어 오릅니다. */
export function isAggregateRow(row: Partial<Record<CardField, string>>): boolean {
  const v = (row.vendor ?? '').replace(/\s+/g, '');
  if (/^총\s?\d+건$/i.test(v) || /^합계$/.test(v) || /^계$/.test(v)) return true;
  // 거래일·금액이 없으면 행으로 보지 않습니다.
  return !row.date || !row.amount;
}

/** `2026.07.19 00:28` · `2026-07-19` · `20260719` · 엑셀 순증수 → 'YYYY-MM-DD' (못 읽으면 '') */
export function parseDate(raw: string): string {
  const s = (raw ?? '').trim();
  if (!s) return '';
  const m = /^(\d{4})[.\-/\u5E74]\s?(\d{1,2})[.\-/\u6708]\s?(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}`;
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  const n = Number(s.replace(/[^\d.-]/g, ''));
  if (Number.isFinite(n) && n > 20000 && n < 80000 && !/[가-힣]/.test(s)) {
    // 엑셀 날짜는 1899-12-30 기산 순증수입니다(1900 역법 버그 보정 포함).
    const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return '';
}

/** `48,500` · `48500.0` · `₩48,500` → 48500 (정수 원). 못 읽으면 null. */
export function parseAmount(raw: string): number | null {
  const s = (raw ?? '').replace(/[^\d.,-]/g, '').replace(/,/g, '');
  if (!s || s === '-' || s === '.') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

export interface CardRowIssue {
  reason: 'no-date' | 'no-amount' | 'cancelled' | 'not-final';
  detail: string;
}

/** 취소·반환·미확정 행을 판정합니다. 기본 정책은 '넘기고 목록에 남기기' 입니다(금액에 섞으면 안 됩니다). */
export function rowIssue(row: Partial<Record<CardField, string>>): CardRowIssue | null {
  const cancel = (row.cancelState ?? '').replace(/\s/g, '');
  const acquire = (row.acquireState ?? '').replace(/\s/g, '');
  if (cancel && !/^(정상|없음|N|false|0)$/i.test(cancel)) return { reason: 'cancelled', detail: `취소상태 ${row.cancelState ?? ''}` };
  if (acquire && !/^(결제확정|확정|매입|승인)$/i.test(acquire)) return { reason: 'not-final', detail: `매입구분 ${row.acquireState ?? ''}` };
  return null;
}

export interface ImportOptions {
  /** 전용(체크)카드 끝번호·이름 조각. 예: ['882'] — 이 값이 없으면 결제경로를 단정하지 않습니다. */
  dedicatedCardTails?: string[];
  /** 협약 집행기간 (YYYY-MM-DD) */
  periodFrom?: string;
  periodTo?: string;
  /** 가맹점명 부분일치 → 예산과목. 첫 회에만 채우고 이후엔 자동이 됩니다. */
  budgetRules?: { match: string; budgetItem: string }[];
  /** 비목을 아직 못 정한 행에 쓸 값. 기본값은 '' (빈 비목은 화면에서 '(비목 미입력)' 으로 드러납니다). */
  defaultBudgetItem?: string;
}

export interface ImportGap {
  kind: 'card-unknown' | 'budget-unmapped' | 'period-unknown' | 'row-skipped' | 'column-unknown' | 'evidence-unread';
  label: string;
  items: string[];
}

export interface ImportResult {
  entries: ReceiptEntry[];
  gaps: ImportGap[];
  /** 파일에서 실제로 읽은 열 (매핑에 실패한 열 이름 포함) */
  headers: string[];
  totalRows: number;
}

/** 카드 구분(선불·후불)으로 결제경로를 좁히려 시도하지만, 전용카드 지정이 없으면 단정하지 않습니다. */
function payMethodOf(row: Partial<Record<CardField, string>>, tails: string[]): ReceiptEntry['payMethod'] {
  const label = `${row.cardLabel ?? ''} ${row.cardKind ?? ''}`;
  if (tails.some((t) => t && label.includes(t))) return '전용(체크)카드';
  return '확인 필요';
}

function periodStateOf(date: string, opt: ImportOptions): ReceiptEntry['periodState'] {
  if (!opt.periodFrom && !opt.periodTo) return '확인 필요';
  if (!date) return '확인 필요';
  const from = opt.periodFrom ?? '0000-01-01';
  const to = opt.periodTo ?? '9999-12-31';
  return date >= from && date <= to ? '기간 내' : '기간 외';
}

function memoOf(row: Partial<Record<CardField, string>>): string {
  const bits: string[] = [];
  // 승인번호는 이제 자체 칸으로 넣습니다(receipts.ReceiptEntry.approvalNo) — 메모에 같은 값을 두 번 적지 않습니다.
  if (row.usageKind) bits.push(row.usageKind);
  if (row.acquireState) bits.push(row.acquireState);
  if (row.industry) bits.push(row.industry);
  return bits.join(' · ').slice(0, 120);
}

/**
 * 행 → 집행 항목. id 는 승인번호 우선, 없으면 거래일+금액+거래처 조합으로 만듭니다(같은 파일 재수입 시 중복 방지).
 */
export function mapRows(rows: Record<CardField, string>[], opt: ImportOptions = {}): ImportResult {
  const tails = (opt.dedicatedCardTails ?? []).map((t) => t.trim()).filter(Boolean);
  const entries: ReceiptEntry[] = [];
  const skipped: string[] = [];
  const unknownCards = new Set<string>();
  const unmappedVendors = new Set<string>();

  for (const row of rows) {
    if (isAggregateRow(row)) continue;
    const issue = rowIssue(row);
    if (issue) {
      skipped.push(`${row.date ?? '?'} ${row.vendor ?? ''} ${issue.detail}`);
      continue;
    }
    const date = parseDate(row.date ?? '');
    const amount = parseAmount(row.amount ?? '');
    if (!date || amount === null || amount <= 0) {
      skipped.push(`${row.date ?? '?'} ${row.vendor ?? ''} (날짜·금액을 읽을 수 없음)`);
      continue;
    }
    const vendor = (row.vendor ?? '').trim();
    const rule = (opt.budgetRules ?? []).find((r) => r.match && vendor.includes(r.match));
    const budgetItem = rule ? rule.budgetItem : (opt.defaultBudgetItem ?? '');
    if (!budgetItem && vendor) unmappedVendors.add(vendor);
    const method = payMethodOf(row, tails);
    if (method === '확인 필요' && row.cardLabel) unknownCards.add(row.cardLabel);
    // 화면이 담는 최대 길이는 receipts 에 있습니다. 여기서 자르지 않으면 미리보기·저장·reload 세 곳이
    // 서로 다른 승인번호를 갖게 되므로(길이가 다른 id ), 자른 값으로 id 와 칸을 함께 만듭니다.
    const approval = (row.approvalNo ?? '').trim().slice(0, MAX_APPROVAL_CHARS);
    const key = approval ? `sa-${approval}` : `sa-${date}-${amount}-${vendor}`;
    entries.push({
      id: key,
      date,
      vendor,
      // 앞자리 0 이 의미 있는 문자열이라 그대로 옮깁니다(숫자로 바꾸면 0 이 사라짐). id 와 같은 값입니다.
      approvalNo: approval,
      amount,
      budgetItem,
      payMethod: method,
      periodState: periodStateOf(date, opt),
      evidenceType: '카드전표(매출전표)',
      evidenceState: '미수취',
      submitState: '미제출',
      memo: memoOf(row)
    });
  }

  const gaps: ImportGap[] = [];
  if (unknownCards.size > 0)
    gaps.push({
      kind: 'card-unknown',
      label: '어느 카드가 전용(체크)카드인지 한 번만 알려 주세요',
      items: [...unknownCards]
    });
  if (unmappedVendors.size > 0)
    gaps.push({ kind: 'budget-unmapped', label: '예산과목이 비어 있는 거래처', items: [...unmappedVendors] });
  if (!opt.periodFrom && !opt.periodTo && entries.length > 0)
    gaps.push({ kind: 'period-unknown', label: '협약 집행기간을 정하면 기간 내·외가 자동 계산됩니다', items: [] });
  if (skipped.length > 0) gaps.push({ kind: 'row-skipped', label: '넘긴 행 (금액에 섞지 않았습니다)', items: skipped });
  if (entries.length > 0)
    gaps.push({
      kind: 'evidence-unread',
      label: '수취상태는 전부 미수취로 넣었습니다 — 전표 파일을 받아 확보로 바꿔 주세요',
      items: []
    });

  return { entries, gaps, headers: [], totalRows: rows.length };
}

/** 최종 수입 결과에 열 이름을 얹습니다(호출 측에서 headers 를 채워 씁니다). */
export function withHeaders(result: ImportResult, headers: string[], unknown: string[]): ImportResult {
  const gaps = [...result.gaps];
  if (unknown.length > 0) gaps.push({ kind: 'column-unknown', label: '인식하지 못한 열 (값은 버렸습니다)', items: unknown });
  return { ...result, headers, gaps };
}

/* ───────────────────────────── 한 번만 답하면 다음 달엔 그냥 들어갑니다 ───────────────────────────── */

/**
 * 파일이 알려 주지 않아 사용자가 정해야 하는 것들. 브라우저 저장소에 `cardSettings` 로 들어갑니다.
 * 지출 행과 함께 백업·복원되어야 새 브라우저에서도 지난 규칙이 그대로 돌아옵니다.
 */
export interface CardSettings {
  /** 전용(체크)카드 끝번호·이름 조각. 빈 배열이면 어느 행의 결제경로도 단정하지 않습니다(전부 `확인 필요`). */
  dedicatedCardTails: string[];
  /** 협약 집행기간 ('' = 미지정) */
  periodFrom: string;
  periodTo: string;
  /** 가맹점명 조각 → 비목 */
  budgetRules: { match: string; budgetItem: string }[];
}

/** 백업·저장 파일에서 읽는 값이므로 개수·길이에 상한을 둡니다(긴 파일 하나로 화면을 늘어지게 못 맞게). */
export const MAX_CARD_TAILS = 20;
export const MAX_CARD_RULES = 300;
const MAX_TAIL_CHARS = 12;
const MAX_MATCH_CHARS = 60;
const MAX_BUDGET_CHARS = 60;

export function emptyCardSettings(): CardSettings {
  return { dedicatedCardTails: [], periodFrom: '', periodTo: '', budgetRules: [] };
}

/** 날짜 입력란 값(YYYY-MM-DD)만 받아들입니다. 다른 형식은 미지정으로 취급해 기간 판정을 보류합니다. */
function isoDay(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

/** 저장소·백업에서 나온 알 수 없는 값을 잘라서 씁니다. 던진 값이 무엇이든 예외는 던지지 않습니다. */
export function normalizeCardSettings(raw: unknown): CardSettings {
  if (typeof raw !== 'object' || raw === null) return emptyCardSettings();
  const o = raw as Record<string, unknown>;
  const tails = Array.isArray(o.dedicatedCardTails) ? o.dedicatedCardTails : [];
  const rules = Array.isArray(o.budgetRules) ? o.budgetRules : [];
  const dedicatedCardTails: string[] = [];
  for (const t of tails.slice(0, MAX_CARD_TAILS)) {
    const s = typeof t === 'string' ? t.trim().slice(0, MAX_TAIL_CHARS) : '';
    if (s && !dedicatedCardTails.includes(s)) dedicatedCardTails.push(s);
  }
  const budgetRules: { match: string; budgetItem: string }[] = [];
  for (const r of rules.slice(0, MAX_CARD_RULES)) {
    if (typeof r !== 'object' || r === null) continue;
    const match = typeof (r as Record<string, unknown>).match === 'string' ? (r as { match: string }).match.trim().slice(0, MAX_MATCH_CHARS) : '';
    const budgetItem =
      typeof (r as Record<string, unknown>).budgetItem === 'string' ? (r as { budgetItem: string }).budgetItem.trim().slice(0, MAX_BUDGET_CHARS) : '';
    if (match && budgetItem) budgetRules.push({ match, budgetItem });
  }
  return { dedicatedCardTails, periodFrom: isoDay(o.periodFrom), periodTo: isoDay(o.periodTo), budgetRules };
}

/** 입력란 문구(`,` 또는 줄바꿈 구분)를 끝번호 목록으로. */
export function parseTails(text: string): string[] {
  const out: string[] = [];
  for (const part of (text ?? '').split(/[,\n;]/)) {
    const s = part.trim().slice(0, MAX_TAIL_CHARS);
    if (s && !out.includes(s)) out.push(s);
  }
  return out.slice(0, MAX_CARD_TAILS);
}

/** `가맹점 조각=비목` 한 줄에 하나. `#` 로 시작하는 줄과 빈 줄은 넘깁니다. */
export function parseBudgetRuleLines(text: string): { match: string; budgetItem: string }[] {
  const out: { match: string; budgetItem: string }[] = [];
  for (const line of (text ?? '').split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const at = s.search(/[=\uFF1D]/);
    if (at < 0) continue;
    const match = s.slice(0, at).trim().slice(0, MAX_MATCH_CHARS);
    const budgetItem = s.slice(at + 1).trim().slice(0, MAX_BUDGET_CHARS);
    if (match && budgetItem && !out.some((r) => r.match === match)) out.push({ match, budgetItem });
  }
  return out.slice(0, MAX_CARD_RULES);
}

export function formatBudgetRuleLines(rules: { match: string; budgetItem: string }[]): string {
  return rules.map((r) => `${r.match}=${r.budgetItem}`).join('\n');
}

/** 저장된 설정 → 수입 옵션. 설정이 빈칸이면 옵션도 비워 두어 `확인 필요`·gaps 로 드러나게 합니다. */
export function cardSettingsToOptions(s: CardSettings): ImportOptions {
  return {
    dedicatedCardTails: s.dedicatedCardTails.slice(),
    periodFrom: s.periodFrom || undefined,
    periodTo: s.periodTo || undefined,
    budgetRules: s.budgetRules.map((r) => ({ ...r }))
  };
}

/** 설정이 채워진 칸이 몇 개인지 — 화면이 '아직 안 정한 것' 수를 셀 때 씁니다. */
export function cardSettingsCompleteness(s: CardSettings): { tails: boolean; period: boolean; rules: boolean } {
  return {
    tails: s.dedicatedCardTails.length > 0,
    period: s.periodFrom !== '' || s.periodTo !== '',
    rules: s.budgetRules.length > 0
  };
}

/* ───────────────────────────── below: 파일 읽기 (zip / csv) ───────────────────────────── */

const td = new TextDecoder();

function view(buf: ArrayBuffer | Uint8Array): DataView {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return new DataView(u.buffer, u.byteOffset, u.byteLength);
}

function u16(d: DataView, at: number): number {
  return d.getUint16(at, true);
}
function u32(d: DataView, at: number): number {
  return d.getUint32(at, true);
}

/** zip 중앙디렉토리를 읽어 항목 이름 → 압축 데이터 위치를 뽑습니다. */
function zipEntries(u: Uint8Array): Map<string, { method: number; compSize: number; dataAt: number }> {
  const d = view(u);
  const SIG_EOCD = 0x06054b50;
  let at = -1;
  const floor = Math.max(0, u.length - 66000);
  for (let i = u.length - 22; i >= floor; i--) {
    if (u32(d, i) === SIG_EOCD) {
      at = i;
      break;
    }
  }
  if (at < 0) throw new Error('zip 끝부분(중앙 디렉토리)을 찾지 못했습니다. .xlsx 파일이 맞는지 확인해 주세요.');
  const count = u16(d, at + 10);
  const cdAt = u32(d, at + 16);
  const out = new Map<string, { method: number; compSize: number; dataAt: number }>();
  let p = cdAt;
  for (let n = 0; n < count; n++) {
    if (u32(d, p) !== 0x02014b50) break;
    const method = u16(d, p + 10);
    const compSize = u32(d, p + 20);
    const nameLen = u16(d, p + 28);
    const extraLen = u16(d, p + 30);
    const commentLen = u16(d, p + 32);
    const localAt = u32(d, p + 42);
    const name = td.decode(u.subarray(p + 46, p + 46 + nameLen));
    // 로컬 헤더에는 data descriptor 가 있으면 sizes 가 0일 수 있어 오프셋만 여기서 계산합니다.
    const lNameLen = u16(d, localAt + 26);
    const lExtraLen = u16(d, localAt + 28);
    out.set(name, { method, compSize, dataAt: localAt + 30 + lNameLen + lExtraLen });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function inflate(bytes: Uint8Array, method: number): Promise<string> {
  if (method === 0) return td.decode(bytes);
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer]);
  const stream = blob.stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return td.decode(new Uint8Array(await new Response(stream).arrayBuffer()));
}

/** 태그 하나를 지운 조각들. 기계가 만든 XML 을 대상으로 한 관용 파서입니다. */
function chunks(xml: string, tag: string): { attrs: string; body: string }[] {
  const out: { attrs: string; body: string }[] = [];
  const re = new RegExp(`<${tag}\\b([^>]*?)(/?)>`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const attrs = m[1] ?? '';
    if (m[2] === '/') {
      out.push({ attrs, body: '' });
      continue;
    }
    const close = `</${tag}>`;
    const end = xml.indexOf(close, re.lastIndex);
    const body = end < 0 ? '' : xml.slice(re.lastIndex, end);
    out.push({ attrs, body });
    if (end >= 0) re.lastIndex = end + close.length;
  }
  return out;
}

function attr(attrs: string, name: string): string {
  // 앞에 단어가 이어 붙은 같은 끝말 attribute 를 걸러냅니다 (예: sT="…" 를 t="…" 로 오인).
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(attrs);
  return m ? m[1] : '';
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function textsOf(body: string): string {
  return chunks(body, 't')
    .map((c) => decodeEntities(c.body))
    .join('');
}

/** sharedStrings.xml → 문자열 표 */
function sharedStrings(xml: string): string[] {
  return chunks(xml, 'si').map((si) => textsOf(si.body));
}

/** 'BC' → 2 (0 기준 열 번호) */
function colIndex(ref: string): number {
  const letters = /^([A-Za-z]+)/.exec(ref ?? '');
  if (!letters) return -1;
  let n = 0;
  for (const ch of letters[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** 시트 XML → 격자 (빈 열은 '' 로 채워 열 번호를 유지합니다) */
function sheetGrid(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const r of chunks(xml, 'row')) {
    const cells: string[] = [];
    for (const c of chunks(r.body, 'c')) {
      const i = colIndex(attr(c.attrs, 'r'));
      if (i < 0) continue;
      const type = attr(c.attrs, 't');
      let value = '';
      if (type === 'inlineStr') value = textsOf(c.body);
      else {
        const v = chunks(c.body, 'v')[0];
        const raw = v ? decodeEntities(v.body) : '';
        if (type === 's') value = shared[Number(raw)] ?? '';
        else if (type === 'str') value = raw;
        else value = raw;
      }
      while (cells.length < i) cells.push('');
      cells[i] = value;
    }
    rows.push(cells);
  }
  return rows;
}

/** .xlsx (OOXML zip) 를 격자로 만듭니다. */
export async function readXlsx(buf: ArrayBuffer | Uint8Array): Promise<string[][]> {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const map = zipEntries(u);
  const get = async (name: string): Promise<string> => {
    const e = map.get(name);
    if (!e) return '';
    const bytes = u.subarray(e.dataAt, e.dataAt + e.compSize);
    return inflate(bytes, e.method);
  };
  // 시트 경로가 sheet1 이 아닌 파일이 있어rels 를 봅니다. 없으면 관용적으로 worksheets 중 처음.
  const relsXml = await get('xl/_rels/workbook.xml.rels');
  let sheetName = '';
  if (relsXml) {
    const candidates = chunks(relsXml, 'Relationship')
      .map((r) => decodeEntities(attr(r.attrs, 'Target')))
      .filter((t) => /worksheets\/[A-Za-z0-9_.-]+\.xml$/.test(t));
    if (candidates.length > 0) sheetName = `xl/${candidates[0].replace(/^\.?\/?/, '')}`;
  }
  if (!map.has(sheetName)) {
    sheetName = [...map.keys()].filter((k) => /^xl\/worksheets\/[^/]+\.xml$/.test(k)).sort()[0] ?? '';
  }
  const [sharedXml, sheetXml] = await Promise.all([get('xl/sharedStrings.xml'), get(sheetName)]);
  if (!sheetXml) throw new Error('시트 내용을 읽지 못했습니다. 보호된 파일이거나 빈 파일일 수 있습니다.');
  return sheetGrid(sheetXml, sharedXml ? sharedStrings(sharedXml) : []);
}

/** CSV·TSV 텍스트를 격자로 만듭니다 (따옴표 안의 구분자·두 번 따옴표 처리). */
export function parseDelimited(text: string): string[][] {
  const t = text.replace(/^\uFEFF/, '');
  const delim = (t.split('\n')[0] ?? '').includes('\t') ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (quoted) {
      if (ch === '"') {
        if (t[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** UTF-8 로 안 읽히면 EUC-KR 로 시도합니다(엑셀 'CSV로 저장'은 EUC-KR로 나오는 경우가 많습니다). */
export async function decodeTable(buf: ArrayBuffer): Promise<string> {
  const u = new Uint8Array(buf);
  try {
    // fatal: true 로 두어, 잘못된 바이트가 조용히 치환문자로 넘어가는 것을 막습니다.
    return new TextDecoder('utf-8', { fatal: true }).decode(u);
  } catch {
    try {
      return new TextDecoder('euc-kr').decode(u);
    } catch {
      return new TextDecoder('utf-8').decode(u);
    }
  }
}

export interface ImportFileResult {
  grid: string[][];
  kind: 'xlsx' | 'csv' | 'tsv';
}

/**
 * 한 파일의 상한. 카드사 명세서는 보통 1MB 을 넘지 않으므로, 이보다 큰 파일은 잘못된 것으로 보고 읽지 않습니다.
 * 해석은 브라우저 메인 스레드에서 돌아가는데, 수십 MB 를 통째로 훑으면 화면이 멎습니다(백업 상한과 같은 이유).
 */
export const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

/** 파일 하나를 격자로. 확장자보다 내용을 먼저 봅니다(zip 매직 → xlsx, 아니면 구분자 텍스트). */
export async function readTableFile(file: { arrayBuffer: () => Promise<ArrayBuffer>; name: string }): Promise<ImportFileResult> {
  const buf = await file.arrayBuffer();
  const u = new Uint8Array(buf);
  if (u.length > MAX_IMPORT_BYTES) {
    throw new Error(`파일이 ${Math.round(MAX_IMPORT_BYTES / 1024 / 1024)}MB 를 넘어 읽지 않았습니다. 명세서 파일치고는 너무 큽니다 — 필요한 기간 행만 잘라 다른 파일로 저장해 주세요.`);
  }
  if (u.length > 4 && u[0] === 0x50 && u[1] === 0x4b) return { grid: await readXlsx(u), kind: 'xlsx' };
  const text = await decodeTable(buf);
  const grid = parseDelimited(text);
  return { grid, kind: (text.split('\n')[0] ?? '').includes('\t') ? 'tsv' : 'csv' };
}

/**
 * 파일 → 항목. UI 는 이 함수 하나만 부릅니다.
 * 헤더를 찾지 못하면 entries 빈 결과 + gaps 에 사유를 담습니다(조용히 0건으로 보이지 않게).
 */
export async function importCardFile(
  file: { arrayBuffer: () => Promise<ArrayBuffer>; name: string },
  opt: ImportOptions = {}
): Promise<ImportResult> {
  const { grid } = await readTableFile(file);
  const parsed = rowsFromGrid(grid);
  if (!parsed) {
    return {
      entries: [],
      gaps: [
        {
          kind: 'column-unknown',
          label: '거래일·가맹점명·금액 열을 찾지 못했습니다. 첫 행이 헤더인지 확인해 주세요',
          items: grid.slice(0, 2).flat().filter((c) => c.trim() !== '').slice(0, 14)
        }
      ],
      headers: [],
      totalRows: grid.length
    };
  }
  const result = mapRows(parsed.rows, opt);
  return withHeaders({ ...result, totalRows: parsed.rows.length }, parsed.headers, parsed.plan.unknown);
}
