/**
 * 브라우저 localStorage 전용 저장 계층.
 * 이 사이트는 서버에 사용자 데이터를 보내지 않습니다. 저장소는 오직 window.localStorage 입니다.
 *
 * 여러 탭이 같은 저장소를 쓰는 경우를 전제로 다음 규칙을 지킵니다.
 * - 쓰기 직전 저장된 값을 다시 읽어(읽기-수정-쓰기) 항목 단위로 합칩니다 → 다른 탭의 입력이 사라지지 않습니다.
 * - 삭제한 id 는 저장소의 removed 목록에 남깁니다 → 오래된 화면을 가진 탭이 지운 행을 되살리지 못합니다.
 * - 삭제 기록이 상한을 넘어 잘려나간 경우에는 그 개수를 화면에 돌려줍니다 → 조용히 되살아나는 행 없음.
 * - 백업 복원(전체 대체)은 restoreAt 시각을 찍습니다 → 복원 전에 태어난 삭제 기록이 복원된 행을 지우지 못합니다.
 * - 저장된 데이터가 이 코드보다 새로운 스키마면 쓰기를 거부하고 화면에 알립니다 → 되돌릴 수 없는 강등 방지.
 * - 백업 복원은 크기·건수 상한을 두고 넘으면 아예 읽지 않습니다 → 복원 시도 한 번으로 탭을 죽일 수 없습니다.
 * - 지울 수 없는 행이 있으면 개수를 그대로 드러냅니다 → 조용히 사라지는 데이터 없음.
 */
import { SCHEMA_VERSION, sanitizeEntries, type ReceiptEntry } from './receipts';
import { emptyCardSettings, normalizeCardSettings, type CardSettings } from './cardimport';
import { emptyReportMeta, normalizeReportMeta, REPORT_FIELDS, type ReportMeta } from './report';

export const STORAGE_KEY = 'startup-help/state/v1';

/** 삭제 기록 상한. 오래된 id 부터 버립니다(지운 개수만큼 자라 파일이 무거워지지 않도록). */
export const MAX_TOMBSTONES = 2000;

/**
 * 백업 복원 상한(파일 크기, 바이트). 화면 컴포넌트가 FileReader 로 읽기 **전에** 봅니다 —
 * 복원은 서버가 없어 이 브라우저 안에서만 일어나므로 '저장소에 안 들어간다' 가 방어가 아닙니다.
 */
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;

/** 같은 수치의 문자 상한(UTF-16 길이). 파일 크기를 볼 수 없는 호출자(parseBackup 을 직접 호출하는 쪽)를 위한 후단입니다. */
export const MAX_BACKUP_CHARS = 20 * 1024 * 1024;

/**
 * 백업 복원 상한(지출 항목 건수).
 * 같은 코드로 재본 값: 행 하나당 저장 키 275~384 B(백업 파일은 줄바꿈·들이쓰기 때문에 약 35% 더 큼).
 * 5,000건은 저장 키 1.3~1.9MB 로 무리 없지만, 50,000건은 13~19MB 가 되어 저장이 용량 초과로 실패하는
 * 경로로 들어가고(실패는 배너로 알립니다) 그보다 먼저 표 렌더링에서 화면이 멈춥니다.
 * 즉 이 선은 '복원은 됐는데 쓸 수 없는 상태' 를 막는 선입니다.
 */
export const MAX_BACKUP_ENTRIES = 5000;

/**
 * 백업 복원 상한(삭제 기록 id + 체크리스트 키).
 * 지출 행만 막으면 같은 구멍이 따로 남습니다: 행이 0개인 파일로도 삭제 기록·체크리스트를
 * 수십만 개 채워 넣을 수 있고, 그 값은 복원 때 어차피 버려지는 것들입니다(복원은 목록 대체·체크리스트 보존).
 */
export const MAX_BACKUP_RECORDS = 100_000;

/** 복원이 거부된 사유. 정상이면 null 입니다. */
export type RestoreRejection = 'too-large' | 'too-many' | 'too-many-records' | null;

/** 복원 성공 결과 — `state` 가 항상 들어 있습니다. */
export interface RestoredState {
  rejected: null;
  rejectedAt: 0;
  state: AppState;
  dropped: number;
  future: boolean;
}

/** 거부된 결과 — `state` 를 아예 담지 않습니다. */
export interface RestoreRejected {
  rejected: Exclude<RestoreRejection, null>;
  rejectedAt: number;
  state: null;
  dropped: 0;
  future: false;
}

/**
 * `rejected` 를 보고받지 않고 넘기는 호출이 실수로 목록을 통째로 바꾸지 못하게,
 * 거부 결과에는 `state` 를 넣지 않는 판별 연합(discriminated union)으로 두었습니다.
 */
export type RestoreResult = RestoredState | RestoreRejected;

function rejectRestore(reason: Exclude<RestoreRejection, null>, at: number): RestoreRejected {
  return { rejected: reason, rejectedAt: at, state: null, dropped: 0, future: false };
}

/** 파일을 읽기 전 단계(화면)용. 바이트 크기가 복원 상한을 넘는지만 봅니다. */
export function isBackupFileTooLarge(bytes: number): boolean {
  // 크기를 잴 수 없는 파일은 넘는 것으로 처리합니다 — 뒤에서 문자 수 상한이 같은 판단을 다시 합니다.
  return !Number.isFinite(bytes) || bytes > MAX_BACKUP_BYTES;
}

export interface ChecklistState {
  [itemId: string]: boolean;
}

export interface AppState {
  schemaVersion: number;
  entries: ReceiptEntry[];
  checklist: ChecklistState;
  /** 이 저장소에서 삭제된 항목 id. 다른 탭이 같은 id 를 다시 보내도 되살아나지 않습니다. */
  removed: string[];
  /** 마지막으로 목록을 통째로 대체(백업 복원)한 시각(ms). 이 값보다 오래된 삭제 기록은 버립니다. */
  restoreAt: number | null;
  lastExportAt: string | null;
  /** 카드사 명세서 수입 설정. 파일이 알려 주지 않아 사용자가 한 번 정한 값이라, 지출 행과 함께 백업됩니다. */
  cardSettings: CardSettings;
  /** 보고서 머리(사업명·신청인·기관·정산 기간·연락처·특이사항). 지출 행과 달리 문서용 값이지만 같은 이유로 백업에 들어갑니다. */
  reportMeta: ReportMeta;
}

export function emptyState(): AppState {
  return {
    schemaVersion: SCHEMA_VERSION,
    entries: [],
    checklist: {},
    removed: [],
    restoreAt: null,
    lastExportAt: null,
    cardSettings: emptyCardSettings(),
    reportMeta: emptyReportMeta()
  };
}

/**
 * 삭제 기록 합치기: 지난 id 를 먼저 두고 새 id 를 뒤에 붙입니다(중복·빈값 제거).
 * 상한을 넘으면 오래된 id 부터 버리고, 버린 개수를 함께 돌려줍니다.
 * 잘려나갔다는 것은 오래된 화면을 든 탭이 그 행을 다시 보낼 수 있다는 뜻이므로 조용히 넘기지 않습니다.
 */
function joinRemoved(existing: readonly string[], adding: readonly string[]): { removed: string[]; trimmed: number } {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of existing.concat(adding)) {
    if (typeof id !== 'string' || id === '' || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out.length > MAX_TOMBSTONES
    ? { removed: out.slice(out.length - MAX_TOMBSTONES), trimmed: out.length - MAX_TOMBSTONES }
    : { removed: out, trimmed: 0 };
}

function safeParse(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** 저장된 원문이 이 코드(SCHEMA_VERSION)보다 새로운 형식인지 봅니다. */
export function isFutureSchema(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  const v = (raw as Record<string, unknown>).schemaVersion;
  return typeof v === 'number' && Number.isFinite(v) && v > SCHEMA_VERSION;
}

/**
 * 저장된 JSON 을 읽습니다. 알 수 없는 형식은 빈 상태로, 읽지 못한 행은 개수로 돌려줍니다.
 * v1 데이터(카드/현금 5종, category 필드)는 sanitizeEntries → normalizeEntry 에서
 * v2(비목·전용카드·집행기간·수취/제출 상태)로 자동 승격됩니다.
 */
export function normalizeState(raw: unknown): { state: AppState; dropped: number; future: boolean } {
  const future = isFutureSchema(raw);
  if (typeof raw !== 'object' || raw === null) return { state: emptyState(), dropped: 0, future: false };
  const o = raw as Record<string, unknown>;
  const inputEntries = Array.isArray(o.entries) ? o.entries : [];
  const entries0 = sanitizeEntries(inputEntries);
  const removedRaw = Array.isArray(o.removed) ? (o.removed as unknown[]) : [];
  // 읽기에서는 자르지 않습니다(저장된 기록을 읽는 쪽이 임의로 잊으면 되살아남). 상한은 쓰기가 붙일 때 적용하고 개수를 알려줍니다.
  const removed = removedRaw.filter((v): v is string => typeof v === 'string' && v !== '');
  const gone = new Set(removed);
  const entries = entries0.filter((e) => !gone.has(e.id));
  const checklistRaw = typeof o.checklist === 'object' && o.checklist !== null ? (o.checklist as Record<string, unknown>) : {};
  const checklist: ChecklistState = {};
  for (const [k, v] of Object.entries(checklistRaw)) {
    if (typeof v === 'boolean') checklist[k] = v;
  }
  return {
    state: {
      schemaVersion: SCHEMA_VERSION,
      entries,
      checklist,
      removed,
      restoreAt: typeof o.restoreAt === 'number' && Number.isFinite(o.restoreAt) ? o.restoreAt : null,
      lastExportAt: typeof o.lastExportAt === 'string' ? o.lastExportAt : null,
      // v3 까지의 저장본·백업에는 이 칸이 아예 없습니다 → 빈 설정으로 승격(추측 값으로 채우지 않습니다).
      cardSettings: normalizeCardSettings(o.cardSettings),
      // v4 까지의 저장본에는 보고서 머리가 없습니다 → 빈 값으로 승격하고, 보고서에서 〔채우기〕 로 보여줍니다.
      reportMeta: normalizeReportMeta(o.reportMeta)
    },
    dropped: Math.max(0, inputEntries.length - entries0.length),
    future
  };
}

export function readStored(storage: Storage | undefined = getStorage()): { state: AppState; dropped: number; future: boolean } {
  if (!storage) return { state: emptyState(), dropped: 0, future: false };
  return normalizeState(safeParse(storage.getItem(STORAGE_KEY)));
}

/** 지출 항목 합치기(읽기-수정-쓰기의 순수 부분). 단위 테스트 대상입니다.
 * - 저장된 값은 그대로 두고, 이번 세션에서 보낸 entries 로 같은 id 를 덮어씁니다(방금 고친 값이 승리).
 * - removed 에 적힌 id 는 양쪽에서 지웁니다(다른 탭에서 삭제한 항목이 되살아나지 않습니다).
 * - 이번 화면이 모르는 id(다른 탭이 방금 추가한 항목)는 보존합니다.
 */
export function mergeEntries(stored: readonly ReceiptEntry[], local: readonly ReceiptEntry[], removed: readonly string[] = []): ReceiptEntry[] {
  const gone = new Set(removed);
  const byId = new Map<string, ReceiptEntry>();
  for (const e of stored) if (!gone.has(e.id)) byId.set(e.id, e);
  for (const e of local) {
    if (gone.has(e.id)) byId.delete(e.id);
    else byId.set(e.id, e);
  }
  return [...byId.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export function loadState(storage: Storage | undefined = getStorage()): AppState {
  return readStored(storage).state;
}

/** 화면용. 드롭 행과 미래 버전 여부를 함께 알려줍니다. */
export function loadStateDetailed(storage: Storage | undefined = getStorage()): { state: AppState; dropped: number; future: boolean } {
  return readStored(storage);
}

/** 저장합니다. 단, 저장된 데이터가 더 새로운 스키마이면 쓰지 않습니다. */
export function saveState(state: AppState, storage: Storage | undefined = getStorage()): boolean {
  if (!storage) return false;
  if (isFutureSchema(safeParse(storage.getItem(STORAGE_KEY)))) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...state, schemaVersion: SCHEMA_VERSION }));
    return true;
  } catch {
    // 시크릿 모드·용량 초과에서는 저장이 조용히 실패합니다. 화면에서 반드시 알려야 합니다.
    return false;
  }
}

/**
 * 지출 항목만 저장합니다. 다른 탭이 체크리스트를 방금 건졌다면 그 값은 보존되고,
 * 다른 탭이 추가한 행은 합쳐집니다. 삭제 기록(removed)은 저장소에 누적되므로
 * 오래된 화면을 든 탭이 지운 행을 다시 보내도 되살아나지 않습니다.
 * 단 삭제 기록이 상한을 넘어 잘려나간 개수(trimmed)는 돌려줍니다 — 그 개수만큼은
 * 오래된 탭이 행을 되살릴 수 있다는 뜻이므로 화면에서 알려야 합니다.
 *
 * knownRestoreAt: 이 화면이 마지막으로 확인한 '목록 통째로 대체' 시각.
 * 저장소의 값이 더 새로우면(= 다른 탭이 복원을 했으면) 이 화면의 목록·삭제 기록을 섞지 않고
 * 저장된 내용을 그대로 돌려줍니다(superseded). 오래된 삭제 기록이 방금 복원된 행을 지우는 일을 막습니다.
 */
export function saveEntries(
  entries: readonly ReceiptEntry[],
  removedIds: readonly string[] = [],
  storage: Storage | undefined = getStorage(),
  knownRestoreAt: number | null = null
): { ok: boolean; merged: ReceiptEntry[]; removed: string[]; future: boolean; trimmed: number; superseded: boolean; restoreAt: number | null } {
  const none = { ok: false, merged: entries.slice(), removed: removedIds.slice(), future: false, trimmed: 0, superseded: false, restoreAt: null };
  if (!storage) return none;
  const stored = readStored(storage);
  if (stored.future)
    return { ok: false, merged: stored.state.entries, removed: stored.state.removed, future: true, trimmed: 0, superseded: false, restoreAt: stored.state.restoreAt };
  if ((stored.state.restoreAt ?? 0) > (knownRestoreAt ?? 0)) {
    return {
      ok: false,
      merged: stored.state.entries,
      removed: stored.state.removed,
      future: false,
      trimmed: 0,
      superseded: true,
      restoreAt: stored.state.restoreAt
    };
  }
  const joined = joinRemoved(stored.state.removed, removedIds);
  const merged = mergeEntries(stored.state.entries, entries, joined.removed);
  const next: AppState = { ...stored.state, entries: merged, removed: joined.removed, schemaVersion: SCHEMA_VERSION };
  const ok = saveState(next, storage);
  return {
    ok,
    merged: ok ? merged : entries.slice(),
    removed: ok ? joined.removed : removedIds.slice(),
    future: false,
    trimmed: ok ? joined.trimmed : 0,
    superseded: false,
    restoreAt: stored.state.restoreAt
  };
}

/** 제출·내보내기 시각 같은 메타만 갱신합니다. */
export function saveMeta(patch: { lastExportAt?: string | null }, storage: Storage | undefined = getStorage()): boolean {
  if (!storage) return false;
  const stored = readStored(storage);
  if (stored.future) return false;
  const next: AppState = {
    ...stored.state,
    lastExportAt: 'lastExportAt' in patch ? (patch.lastExportAt ?? null) : stored.state.lastExportAt
  };
  return saveState(next, storage);
}

/**
 * 카드사 명세서 수입 설정만 저장합니다. 지출 행은 건드리지 않습니다.
 * 다른 탭이 이 칸을 고쳤을 수 있어 항상 저장된 값을 다시 읽은 뒤 그 위에 씁니다(덮어쓰는 칸은 설정 하나뿐).
 */
export function saveCardSettings(
  settings: CardSettings,
  storage: Storage | undefined = getStorage()
): { ok: boolean; future: boolean; settings: CardSettings } {
  const next = normalizeCardSettings(settings);
  if (!storage) return { ok: false, future: false, settings: next };
  const stored = readStored(storage);
  if (stored.future) return { ok: false, future: true, settings: stored.state.cardSettings };
  return { ok: saveState({ ...stored.state, cardSettings: next }, storage), future: false, settings: next };
}

/**
 * 체크리스트만 저장합니다. 지출 항목은 저장된 값을 그대로 두므로,
 * 다른 탭에서 정리 도구를 쓰다가 이 화면에서 체크하나 켜도 입력이 사라지지 않습니다.
 * 여러 탭의 체크 결과는 합칩니다(저장된 값 + 이번 값).
 */
export function saveChecklist(checklist: ChecklistState, storage: Storage | undefined = getStorage()): boolean {
  if (!storage) return false;
  const stored = readStored(storage);
  if (stored.future) return false;
  return saveState({ ...stored.state, checklist: { ...stored.state.checklist, ...checklist } }, storage);
}

/** 지출 목록만 비웁니다(체크리스트는 남깁니다). 지금 있던 id 는 삭제 기록으로 남깁니다. */
export function clearEntries(storage: Storage | undefined = getStorage()): { ok: boolean; removed: string[]; future: boolean; trimmed: number } {
  if (!storage) return { ok: false, removed: [], future: false, trimmed: 0 };
  const stored = readStored(storage);
  if (stored.future) return { ok: false, removed: stored.state.removed, future: true, trimmed: 0 };
  const joined = joinRemoved(stored.state.removed, stored.state.entries.map((e) => e.id));
  const ok = saveState({ ...stored.state, entries: [], removed: joined.removed }, storage);
  return { ok, removed: ok ? joined.removed : [], future: false, trimmed: ok ? joined.trimmed : 0 };
}

/** 이 브라우저의 이 사이트 데이터를 전부 삭제합니다(체크리스트 포함). */
export function clearState(storage: Storage | undefined = getStorage()): void {
  if (!storage) return;
  storage.removeItem(STORAGE_KEY);
}

export function getStorage(): Storage | undefined {
  try {
    const s = window.localStorage;
    // 접근 자체에 예외가 나는 브라우저 설정이 있습니다.
    s.setItem('__probe__', '1');
    s.removeItem('__probe__');
    return s;
  } catch {
    return undefined;
  }
}

/** 백업/복원용 JSON 파일 이름 */
export function backupFileName(date: Date = new Date()): string {
  return `startup-help-backup_${date.toISOString().slice(0, 10).replace(/-/g, '')}.json`;
}

export function serializeState(state: AppState): string {
  return JSON.stringify({ ...state, schemaVersion: SCHEMA_VERSION }, null, 2);
}

export function parseBackup(text: string): RestoreResult {
  // 1차 — 해석하기 전에 길이로 막습니다. 수십 MB 를 파싱한 뒤 버리는 것은 방어가 아니고,
  // 화면에 닿기 전에 이 브라우저 탭부터 무너집니다.
  if (text.length > MAX_BACKUP_CHARS) return rejectRestore('too-large', text.length);
  const parsed = safeParse(text);
  const raw = parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  // 2차 — 지출 행 건수. normalizeState 가 행을 골라내기 전에 원시 배열 길이로 봅니다.
  const entryCount = Array.isArray(raw.entries) ? raw.entries.length : 0;
  if (entryCount > MAX_BACKUP_ENTRIES) return rejectRestore('too-many', entryCount);
  // 3차 — 삭제 기록·체크리스트 개수. 행이 한 줄도 없는 파일로도 이 부분만 채워 같은 사고를 낼 수 있고,
  // 복원 때 삭제 기록은 비워지고 체크리스트는 파일 값이 쓰이지 않습니다(대체 대상이 아님).
  const recordCount =
    (Array.isArray(raw.removed) ? raw.removed.length : 0) +
    (raw.checklist !== null && typeof raw.checklist === 'object' ? Object.keys(raw.checklist as object).length : 0);
  if (recordCount > MAX_BACKUP_RECORDS) return rejectRestore('too-many-records', recordCount);
  // 거부된 경로에서는 future 판정을 다시 묻지 않습니다 — 화면에는 거부 사유가 먼저입니다.
  return { ...normalizeState(parsed), rejected: null, rejectedAt: 0 };
}

/**
 * 백업 복원용. 목록 전체를 **대체**합니다(saveEntries 와 달리 id 병합 없음 — 복원은 대체라는 약속).
 * 체크리스트는 저장된 값을 보존하고, 삭제 기록은 비웁니다(복원 파일의 행이 지난 삭제에 지워지면 안 됩니다).
 * 대신 대체 시각(restoreAt)을 찍습니다. 이 값이 커지면 다른 탭은 자기가 들고 있던 삭제 기록을
 * 버리고 저장된 목록을 그대로 받아들입니다 — 복원된 행을 예전 삭제 기록이 지워버리는 사고 방지.
 *
 * `cardSettings` · `reportMeta` 는 예외적으로 파일 값을 받아들이니다(비어 있으면 지금 값 유지) — 지난 달에 정해 둔
 * 수입 규칙과 보고서 머리(사업명·신청인·기관)를 새 브라우저에서 다시 입력하지 않아도 되게 만드는 것이 그 값들의 존재 이유입니다.
 */
export function replaceEntries(
  entries: readonly ReceiptEntry[],
  storage: Storage | undefined = getStorage(),
  at: number = Date.now(),
  cardSettings?: CardSettings,
  reportMeta?: ReportMeta
): { ok: boolean; future: boolean; restoreAt: number | null; cardSettings: CardSettings; reportMeta: ReportMeta } {
  const fallbackSettings = normalizeCardSettings(cardSettings ?? emptyCardSettings());
  const fallbackMeta = normalizeReportMeta(reportMeta ?? emptyReportMeta());
  if (!storage)
    return { ok: false, future: false, restoreAt: null, cardSettings: fallbackSettings, reportMeta: fallbackMeta };
  const stored = readStored(storage);
  if (stored.future)
    return {
      ok: false,
      future: true,
      restoreAt: stored.state.restoreAt,
      cardSettings: stored.state.cardSettings,
      reportMeta: stored.state.reportMeta
    };
  const settings = cardSettings && hasCardSettings(cardSettings) ? cardSettings : stored.state.cardSettings;
  const meta = reportMeta && hasReportMeta(reportMeta) ? reportMeta : stored.state.reportMeta;
  const ok = saveState(
    { ...stored.state, entries: entries.slice(), removed: [], restoreAt: at, cardSettings: settings, reportMeta: meta },
    storage
  );
  return {
    ok,
    future: false,
    restoreAt: ok ? at : stored.state.restoreAt,
    cardSettings: settings,
    reportMeta: meta
  };
}

/** 설정에 실제로 들어찬 칸이 하나라도 있는지 (빈 설정으로 지금 값을 덮어쓰지 않기 위한 판단). */
export function hasCardSettings(s: CardSettings): boolean {
  return s.dedicatedCardTails.length > 0 || s.budgetRules.length > 0 || s.periodFrom !== '' || s.periodTo !== '';
}

/** 보고서 머리에 실제로 적힌 값이 하나라도 있는지 (빈 머리로 지금 값을 지우지 않기 위한 판단). */
export function hasReportMeta(m: ReportMeta): boolean {
  return REPORT_FIELDS.some((f) => m[f.key] !== '');
}

/**
 * 보고서 머리만 저장합니다. 지출 행·수입 설정은 건드리지 않습니다(저장된 값을 다시 읽고 그 위에 얹습니다).
 * 화면의 「이것만 채워 주세요」에 답한 값이 다음 보고서·백업까지 살아남게 하는 것이 목적입니다.
 */
export function saveReportMeta(
  meta: ReportMeta,
  storage: Storage | undefined = getStorage()
): { ok: boolean; future: boolean; meta: ReportMeta } {
  const next = normalizeReportMeta(meta);
  if (!storage) return { ok: false, future: false, meta: next };
  const stored = readStored(storage);
  if (stored.future) return { ok: false, future: true, meta: stored.state.reportMeta };
  return { ok: saveState({ ...stored.state, reportMeta: next }, storage), future: false, meta: next };
}
