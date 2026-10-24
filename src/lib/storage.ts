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
 * - 지울 수 없는 행이 있으면 개수를 그대로 드러냅니다 → 조용히 사라지는 데이터 없음.
 */
import { SCHEMA_VERSION, sanitizeEntries, type ReceiptEntry } from './receipts';

export const STORAGE_KEY = 'startup-help/state/v1';

/** 삭제 기록 상한. 오래된 id 부터 버립니다(지운 개수만큼 자라 파일이 무거워지지 않도록). */
export const MAX_TOMBSTONES = 2000;

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
}

export function emptyState(): AppState {
  return {
    schemaVersion: SCHEMA_VERSION,
    entries: [],
    checklist: {},
    removed: [],
    restoreAt: null,
    lastExportAt: null
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
      lastExportAt: typeof o.lastExportAt === 'string' ? o.lastExportAt : null
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

export function parseBackup(text: string): { state: AppState; dropped: number; future: boolean } {
  return normalizeState(safeParse(text));
}

/**
 * 백업 복원용. 목록 전체를 **대체**합니다(saveEntries 와 달리 id 병합 없음 — 복원은 대체라는 약속).
 * 체크리스트는 저장된 값을 보존하고, 삭제 기록은 비웁니다(복원 파일의 행이 지난 삭제에 지워지면 안 됩니다).
 * 대신 대체 시각(restoreAt)을 찍습니다. 이 값이 커지면 다른 탭은 자기가 들고 있던 삭제 기록을
 * 버리고 저장된 목록을 그대로 받아들입니다 — 복원된 행을 예전 삭제 기록이 지워버리는 사고 방지.
 */
export function replaceEntries(
  entries: readonly ReceiptEntry[],
  storage: Storage | undefined = getStorage(),
  at: number = Date.now()
): { ok: boolean; future: boolean; restoreAt: number | null } {
  if (!storage) return { ok: false, future: false, restoreAt: null };
  const stored = readStored(storage);
  if (stored.future) return { ok: false, future: true, restoreAt: stored.state.restoreAt };
  const ok = saveState({ ...stored.state, entries: entries.slice(), removed: [], restoreAt: at }, storage);
  return { ok, future: false, restoreAt: ok ? at : stored.state.restoreAt };
}
