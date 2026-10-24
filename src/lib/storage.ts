/**
 * 브라우저 localStorage 전용 저장 계층.
 * 이 사이트는 서버에 사용자 데이터를 보내지 않습니다. 저장소는 오직 window.localStorage 입니다.
 */
import { SCHEMA_VERSION, sanitizeEntries, type ReceiptEntry } from './receipts';

export const STORAGE_KEY = 'startup-help/state/v1';

export interface ChecklistState {
  [itemId: string]: boolean;
}

export interface AppState {
  schemaVersion: number;
  entries: ReceiptEntry[];
  checklist: ChecklistState;
  lastExportAt: string | null;
}

export function emptyState(): AppState {
  return {
    schemaVersion: SCHEMA_VERSION,
    entries: [],
    checklist: {},
    lastExportAt: null
  };
}

function safeParse(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * 저장된 JSON 을 읽습니다. 알 수 없는 스키마 버전·깨진 데이터는 빈 상태로 되돌립니다.
 * 손실된 항목 수는 되살아나지 않으므로, 호출 화면에서 안내 문구를 띄웁니다.
 */
export function normalizeState(raw: unknown): { state: AppState; dropped: number } {
  if (typeof raw !== 'object' || raw === null) return { state: emptyState(), dropped: 0 };
  const o = raw as Record<string, unknown>;
  const inputEntries = Array.isArray(o.entries) ? o.entries : [];
  const entries = sanitizeEntries(inputEntries);
  const checklistRaw = typeof o.checklist === 'object' && o.checklist !== null ? (o.checklist as Record<string, unknown>) : {};
  const checklist: ChecklistState = {};
  for (const [k, v] of Object.entries(checklistRaw)) {
    if (typeof v === 'boolean') checklist[k] = v;
  }
  return {
    state: {
      // v1 데이터(카드/현금 5종, category 필드)는 sanitizeEntries → normalizeEntry 에서
      // v2(비목·전용카드·집행기간·수취/제출 상태)로 자동 승격됩니다. 읽을 수 없는 행만 버립니다.
      schemaVersion: SCHEMA_VERSION,
      entries,
      checklist,
      lastExportAt: typeof o.lastExportAt === 'string' ? o.lastExportAt : null
    },
    dropped: Math.max(0, inputEntries.length - entries.length)
  };
}

export function loadState(storage: Storage | undefined = getStorage()): AppState {
  if (!storage) return emptyState();
  return normalizeState(safeParse(storage.getItem(STORAGE_KEY))).state;
}

export function saveState(state: AppState, storage: Storage | undefined = getStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...state, schemaVersion: SCHEMA_VERSION }));
    return true;
  } catch {
    // 시크릿 모드·용량 초과에서는 저장이 조용히 실패합니다. 화면에서 반드시 알려야 합니다.
    return false;
  }
}

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

export function parseBackup(text: string): { state: AppState; dropped: number } {
  return normalizeState(safeParse(text));
}
