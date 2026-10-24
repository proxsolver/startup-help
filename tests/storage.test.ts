import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_TOMBSTONES,
  STORAGE_KEY,
  backupFileName,
  clearEntries,
  clearState,
  emptyState,
  getStorage,
  isFutureSchema,
  loadState,
  loadStateDetailed,
  mergeEntries,
  normalizeState,
  parseBackup,
  readStored,
  replaceEntries,
  saveChecklist,
  saveEntries,
  saveMeta,
  saveState,
  serializeState
} from '../src/lib/storage';
import { SCHEMA_VERSION, type ReceiptEntry } from '../src/lib/receipts';

const entry = (id: string, date: string, over: Partial<ReceiptEntry> = {}): ReceiptEntry => ({
  id,
  date,
  vendor: `거래처${id}`,
  amount: 1000,
  budgetItem: '재료비',
  payMethod: '전용(체크)카드',
  evidenceType: '카드전표(매출전표)',
  evidenceState: '원본 확보',
  periodState: '기간 내',
  submitState: '미제출',
  memo: '',
  ...over
});

class FakeStorage {
  private map = new Map<string, string>();
  constructor(private failOnSet = false) {}
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    if (this.failOnSet) throw new Error('QuotaExceeded');
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  get length() {
    return this.map.size;
  }
}

const asStorage = (fail = false) => new FakeStorage(fail) as unknown as Storage;

describe('normalizeState', () => {
  it('형식이 아무것도 아니면 빈 상태', () => {
    for (const bad of [null, undefined, 'x', 12, []]) {
      const { state, dropped } = normalizeState(bad);
      expect(state.entries).toEqual([]);
      expect(state.checklist).toEqual({});
      expect(dropped).toBe(0);
    }
  });

  it('깨진 항목은 버리고 개수를 보고한다', () => {
    const { state, dropped } = normalizeState({
      entries: [
        { date: '2026-03-01', vendor: 'A', amount: 100 },
        { date: '2026-03-02', vendor: 'B', amount: -1 },
        { date: 'bad', vendor: 'C', amount: 5 }
      ],
      checklist: { 'setup-01': true, 'setup-02': 'yes', n: 3 }
    });
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0].budgetItem).toBe('기타');
    expect(state.entries[0].submitState).toBe('미제출');
    expect(dropped).toBe(2);
    expect(state.checklist).toEqual({ 'setup-01': true });
  });

  it('lastExportAt 문자열과 스키마 버전을 보존한다', () => {
    const { state } = normalizeState({ entries: [], schemaVersion: 999, lastExportAt: '2026-03-31T10:00:00.000Z' });
    expect(state.lastExportAt).toBe('2026-03-31T10:00:00.000Z');
    expect(state.schemaVersion).toBe(SCHEMA_VERSION);
  });
});

describe('saveState / loadState 왕복', () => {
  let storage: Storage;
  beforeEach(() => {
    storage = asStorage();
  });

  it('저장 후 읽어온다', () => {
    const state = emptyState();
    state.entries.push({
      id: 'a',
      date: '2026-03-01',
      vendor: 'A',
      amount: 5000,
      budgetItem: '재료비',
      payMethod: '현금',
      evidenceType: '현금영수증',
      evidenceState: '원본 확보',
      periodState: '기간 내',
      submitState: '미제출',
      memo: ''
    });
    state.checklist['setup-01'] = true;
    expect(saveState(state, storage)).toBe(true);
    const back = loadState(storage);
    expect(back.entries[0].vendor).toBe('A');
    expect(back.entries[0].budgetItem).toBe('재료비');
    expect(back.checklist['setup-01']).toBe(true);
  });

  it('v1 형태로 저장되어 있던 데이터도 읽어올 때 v2 로 승격된다', () => {
    const v1 = JSON.stringify({
      schemaVersion: 1,
      entries: [
        {
          id: 'old1',
          date: '2026-02-11',
          vendor: '예전 거래처',
          amount: 30000,
          payMethod: '카드',
          evidenceType: '신용카드매출전표',
          regularEvidence: true,
          category: '매입·원재료',
          memo: '예전 메모'
        }
      ],
      checklist: { 'm1-01': true }
    });
    storage.setItem(STORAGE_KEY, v1);
    const back = loadState(storage);
    expect(back.entries).toHaveLength(1);
    expect(back.entries[0].budgetItem).toBe('매입·원재료');
    expect(back.entries[0].payMethod).toBe('확인 필요');
    expect(back.entries[0].evidenceType).toBe('카드전표(매출전표)');
    expect(back.entries[0].evidenceState).toBe('원본 확보');
    expect(back.entries[0].periodState).toBe('확인 필요');
    expect(back.entries[0].submitState).toBe('미제출');
    expect(back.schemaVersion).toBe(SCHEMA_VERSION);
    expect(back.checklist['m1-01']).toBe(true);
  });

  it('저장 실패(시크릿 모드·용량 초과)를 false 로 알려준다', () => {
    expect(saveState(emptyState(), asStorage(true))).toBe(false);
  });

  it('저장소가 없으면 빈 상태, 저장은 실패', () => {
    expect(loadState(undefined)).toEqual(emptyState());
    expect(saveState(emptyState(), undefined)).toBe(false);
  });

  it('저장소를 찾을 수 없으면 undefined 를 돌려준다', () => {
    // node 환경(window 없음)에서는 getStorage() 가 undefined 가 되어야 안전하다.
    expect(getStorage()).toBeUndefined();
  });

  it('clearState 는 키를 지운다', () => {
    saveState(emptyState(), storage);
    clearState(storage);
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    expect(loadState(storage).entries).toEqual([]);
  });

  it('깨진 JSON 은 빈 상태로 되돌아간다', () => {
    storage.setItem(STORAGE_KEY, '{oops');
    expect(loadState(storage).entries).toEqual([]);
  });
});

describe('백업 파일 형식', () => {
  it('serialize → parse 왕복', () => {
    const state = emptyState();
    state.entries.push({
      id: 'z',
      date: '2026-01-09',
      vendor: '택배',
      amount: 3000,
      budgetItem: '출장·교통',
      payMethod: '계좌이체',
      evidenceType: '없음',
      evidenceState: '미수취',
      periodState: '확인 필요',
      submitState: '초안 포함',
      memo: '샘플'
    });
    const { state: restored, dropped } = parseBackup(serializeState(state));
    expect(dropped).toBe(0);
    expect(restored.entries[0].memo).toBe('샘플');
    expect(restored.entries[0].budgetItem).toBe('출장·교통');
    expect(restored.entries[0].submitState).toBe('초안 포함');
    expect(restored.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('형식이 다른 파일은 빈 상태로', () => {
    expect(parseBackup('not json').state.entries).toEqual([]);
  });

  it('백업 파일명에 날짜가 들어간다', () => {
    expect(backupFileName(new Date('2026-03-31T12:00:00Z'))).toBe('startup-help-backup_20260331.json');
  });
});

describe('mergeEntries (여러 탭 합치기 규칙)', () => {
  it('저장된 항목과 이번 화면 항목을 id 로 합치고 같은 id 는 이번 값이 이긴다', () => {
    const stored = [entry('a', '2026-03-01'), entry('b', '2026-03-02')];
    const local = [entry('a', '2026-03-01', { amount: 9999 }), entry('c', '2026-03-03')];
    const merged = mergeEntries(stored, local);
    expect(merged.map((e) => e.id).sort()).toEqual(['a', 'b', 'c']);
    expect(merged.find((e) => e.id === 'a')!.amount).toBe(9999);
  });

  it('removed 에 적힌 id 는 양쪽에서 사라진다', () => {
    const merged = mergeEntries([entry('a', '2026-03-01'), entry('b', '2026-03-02')], [entry('c', '2026-03-03')], ['b']);
    expect(merged.map((e) => e.id).sort()).toEqual(['a', 'c']);
  });

  it('날짜 내림차순으로 정리해 화면 순서를 맞춘다', () => {
    const merged = mergeEntries([], [entry('a', '2026-01-01'), entry('b', '2026-03-03'), entry('c', '2026-02-02')]);
    expect(merged.map((e) => e.date)).toEqual(['2026-03-03', '2026-02-02', '2026-01-01']);
  });
});

describe('스키마 버전 안전장치', () => {
  it('더 새로운 버전 표지를 감지한다', () => {
    expect(isFutureSchema({ schemaVersion: SCHEMA_VERSION + 1 })).toBe(true);
    expect(isFutureSchema({ schemaVersion: SCHEMA_VERSION })).toBe(false);
    expect(isFutureSchema({ schemaVersion: 'x' })).toBe(false);
    expect(isFutureSchema(null)).toBe(false);
  });

  it('readStored 는 미래 형식이면 future 를 알려준다', () => {
    const storage = asStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 99, entries: [{ date: '2026-03-01', amount: 5 }] }));
    expect(readStored(storage).future).toBe(true);
    expect(loadStateDetailed(storage).future).toBe(true);
  });

  it('미래 형식 저장소에는 어떤 쓰기도 일어나지 않는다', () => {
    const storage = asStorage();
    const raw = JSON.stringify({ schemaVersion: 99, entries: [], checklist: { keep: true } });
    storage.setItem(STORAGE_KEY, raw);
    expect(saveState(emptyState(), storage)).toBe(false);
    expect(saveEntries([entry('a', '2026-03-01')], [], storage).ok).toBe(false);
    expect(saveChecklist({ 'set-01': true }, storage)).toBe(false);
    expect(clearEntries(storage).ok).toBe(false);
    expect(saveMeta({ lastExportAt: 'now' }, storage)).toBe(false);
    // 원문은 그대로 — 되돌릴 수 없는 강등이 일어나지 않았다는 뜻입니다.
    expect(storage.getItem(STORAGE_KEY)).toBe(raw);
  });

  it('정상 버전에서는 쓰기가 작동하고 스키마 버전이 현재 값으로 기록된다', () => {
    const storage = asStorage();
    const res = saveEntries([entry('a', '2026-03-01')], [], storage);
    expect(res.ok).toBe(true);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).schemaVersion).toBe(SCHEMA_VERSION);
  });
});

describe('관심사별 저장 (두 탭이 서로를 덮어쓰지 않는다)', () => {
  let storage: Storage;
  beforeEach(() => {
    storage = asStorage();
  });

  it('saveEntries 는 저장된 체크리스트를 보존하고 다른 탭의 행을 합친다', () => {
    saveState({ ...emptyState(), entries: [entry('other', '2026-03-05')], checklist: { 'set-01': true } }, storage);
    const res = saveEntries([entry('mine', '2026-03-04')], [], storage);
    expect(res.merged.map((e) => e.id).sort()).toEqual(['mine', 'other']);
    const back = loadState(storage);
    expect(back.checklist['set-01']).toBe(true);
    expect(back.entries.map((e) => e.id).sort()).toEqual(['mine', 'other']);
  });

  it('saveChecklist 는 저장된 지출 항목을 건드리지 않는다', () => {
    saveState({ ...emptyState(), entries: [entry('a', '2026-03-01')] }, storage);
    expect(saveChecklist({ 'set-02': true }, storage)).toBe(true);
    const back = loadState(storage);
    expect(back.entries).toHaveLength(1);
    expect(back.checklist['set-02']).toBe(true);
  });

  it('체크리스트는 합쳐진다 (다른 탭에서 체크한 항목이 사라지지 않는다)', () => {
    saveChecklist({ 'set-01': true }, storage);
    saveChecklist({ 'set-03': true }, storage);
    expect(loadState(storage).checklist).toEqual({ 'set-01': true, 'set-03': true });
  });

  it('clearEntries 는 지출만 비우고 체크리스트는 남긴다', () => {
    saveState({ ...emptyState(), entries: [entry('a', '2026-03-01')], checklist: { 'set-01': true } }, storage);
    const res = clearEntries(storage);
    expect(res.ok).toBe(true);
    expect(res.removed).toEqual(['a']);
    const back = loadState(storage);
    expect(back.entries).toEqual([]);
    expect(back.checklist['set-01']).toBe(true);
  });

  it('replaceEntries 는 병합하지 않고 목록을 통째로 대체한다(복원은 대체)', () => {
    saveState({ ...emptyState(), entries: [entry('old1', '2026-02-01'), entry('old2', '2026-02-02')] }, storage);
    expect(replaceEntries([entry('new', '2026-03-01')], storage).ok).toBe(true);
    expect(loadState(storage).entries.map((e) => e.id)).toEqual(['new']);
  });

  it('복원한 파일의 행은 지난 삭제 기록에 지워지지 않는다(복원이 기록을 초기화)', () => {
    saveState({ ...emptyState(), entries: [entry('a', '2026-03-01')], removed: ['a'] }, storage);
    expect(replaceEntries([entry('a', '2026-03-01')], storage).ok).toBe(true);
    const back = loadState(storage);
    expect(back.entries.map((e) => e.id)).toEqual(['a']);
    expect(back.removed).toEqual([]);
    // 복원 뒤 화면이 이어 저장해도 같은 id 가 지워지지 않는다
    saveEntries(back.entries, back.removed, storage);
    expect(loadState(storage).entries.map((e) => e.id)).toEqual(['a']);
  });

  it('saveMeta 는 lastExportAt 만 갱신한다', () => {
    saveState({ ...emptyState(), entries: [entry('a', '2026-03-01')] }, storage);
    expect(saveMeta({ lastExportAt: '2026-03-31T10:00:00.000Z' }, storage)).toBe(true);
    const back = loadState(storage);
    expect(back.lastExportAt).toBe('2026-03-31T10:00:00.000Z');
    expect(back.entries).toHaveLength(1);
  });

  it('지운 id 는 다시 저장해도 되살아나지 않는다', () => {
    saveState({ ...emptyState(), entries: [entry('a', '2026-03-01'), entry('b', '2026-03-02')] }, storage);
    const res = saveEntries([entry('a', '2026-03-01'), entry('b', '2026-03-02')], ['b'], storage);
    expect(res.merged.map((e) => e.id)).toEqual(['a']);
    expect(loadState(storage).entries.map((e) => e.id)).toEqual(['a']);
  });

  it('삭제 기록은 저장소에 남는다 (화면을 오래 둔 탭이 지운 행을 되살리지 못한다)', () => {
    // 탭 A: b 를 지운다.
    saveState({ ...emptyState(), entries: [entry('a', '2026-03-01'), entry('b', '2026-03-02')] }, storage);
    const a = saveEntries([entry('a', '2026-03-01')], ['b'], storage);
    expect(a.removed).toEqual(['b']);
    // 탭 B: b 가 아직 있다고 믿고 저장한다(자기 화면 목록 + 새 행 c).
    const b = saveEntries([entry('a', '2026-03-01'), entry('b', '2026-03-02'), entry('c', '2026-03-03')], [], storage);
    expect(b.merged.map((e) => e.id).sort()).toEqual(['a', 'c']);
    expect(loadState(storage).removed).toEqual(['b']);
  });

  it('삭제 기록은 누적되되 상한을 넘으면 오래된 id 부터 버린다', () => {
    const many = Array.from({ length: MAX_TOMBSTONES + 20 }, (_, i) => `x${i}`);
    const first = saveEntries([entry('keep', '2026-03-01')], many, storage);
    expect(first.removed).toHaveLength(MAX_TOMBSTONES);
    expect(first.removed[0]).toBe('x20');
    expect(first.removed[first.removed.length - 1]).toBe(`x${many.length - 1}`);
    // 버려진 오래된 id 는 다시 들어올 수 있다(기록이 없으므로).
    const back = saveEntries([entry('keep', '2026-03-01'), entry('x0', '2026-03-02')], [], storage);
    expect(back.merged.map((e) => e.id).sort()).toEqual(['keep', 'x0']);
  });

  it('저장된 removed 는 읽을 때 행을 걸러내고, 없는 형식(구 저장본)은 빈 목록으로 다룬다', () => {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ schemaVersion: 2, entries: [entry('a', '2026-03-01'), entry('b', '2026-03-02')], removed: ['b', 7, ''] })
    );
    const read = readStored(storage);
    expect(read.state.entries.map((e) => e.id)).toEqual(['a']);
    expect(read.state.removed).toEqual(['b']);
    // removed 가 전혀 없는 구 버전 저장본
    storage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 2, entries: [entry('a', '2026-03-01')] }));
    expect(readStored(storage).state.removed).toEqual([]);
  });

  it('목록을 비운 뒤 오래된 탭이 행을 보내도 되살아나지 않는다', () => {
    saveState({ ...emptyState(), entries: [entry('a', '2026-03-01'), entry('b', '2026-03-02')] }, storage);
    const cleared = clearEntries(storage);
    expect(cleared.removed.sort()).toEqual(['a', 'b']);
    const stale = saveEntries([entry('a', '2026-03-01'), entry('b', '2026-03-02')], [], storage);
    expect(stale.merged).toEqual([]);
  });

  it('비우기로 만든 삭제 기록도 상한을 넘지 않는다', () => {
    const many = Array.from({ length: MAX_TOMBSTONES + 5 }, (_, i) => entry(`x${i}`, '2026-03-01'));
    saveState({ ...emptyState(), entries: many, removed: ['old-1', 'old-2'] }, storage);
    const cleared = clearEntries(storage);
    expect(cleared.removed).toHaveLength(MAX_TOMBSTONES);
    expect(cleared.trimmed).toBe(7);
    expect(cleared.removed[0]).toBe('x5');
    expect(cleared.removed).not.toContain('old-1');
    expect(cleared.removed[cleared.removed.length - 1]).toBe(`x${MAX_TOMBSTONES + 4}`);
    expect(loadState(storage).removed).toHaveLength(MAX_TOMBSTONES);
  });
});

/**
 * 화면(ReceiptTool)이 지켜야 있는 계약들 — 지운 행·백업·두 탭 복원이 서로를 망치지 않는지 확인합니다.
 * 화면은 삭제 기록을 따로 두지 않고 state.removed 하나만 씁니다. 아래도 그 방식으로 검증합니다.
 */
describe('삭제 기록 일관성 (백업·복원·상한)', () => {
  let storage: Storage;
  beforeEach(() => {
    storage = asStorage();
  });

  /** 화면처럼: 저장본을 읽고 → 바꾸고 → 저장하고 → 다시 읽는다. */
  const liveIds = () => loadState(storage).entries.map((e) => e.id).sort();

  it('화면 상태의 삭제 기록이 저장본과 어긋나지 않는다 (백업이 자기 행을 지우는 사고 방지)', () => {
    saveState({ ...emptyState(), entries: [entry('a', '2026-03-01'), entry('b', '2026-03-02')] }, storage);
    let state = loadState(storage);
    // b 삭제
    const del = saveEntries(
      state.entries.filter((e) => e.id !== 'b'),
      [...state.removed, 'b'],
      storage,
      state.restoreAt
    );
    state = { ...state, entries: del.merged, removed: del.removed };
    expect(liveIds()).toEqual(['a']);

    // 이 상태 그대로 복원했다가 다시 백업으로 받는 왕복
    const replace = replaceEntries([entry('a', '2026-03-01'), entry('b', '2026-03-02')], storage, 1000);
    expect(replace.ok).toBe(true);
    state = { ...state, entries: loadState(storage).entries, removed: loadState(storage).removed };
    const backup = parseBackup(serializeState(state));
    expect(backup.state.entries.map((e) => e.id).sort()).toEqual(['a', 'b']);
    expect(backup.dropped).toBe(0);
  });

  it('삭제 기록이 살아 있는 행과 겹치지 않는다 (지운 id 만 기록에 남는다)', () => {
    saveState({ ...emptyState(), entries: [entry('a', '2026-03-01'), entry('b', '2026-03-02')] }, storage);
    saveEntries([entry('a', '2026-03-01')], ['b'], storage);
    const afterDelete = loadState(storage);
    expect(afterDelete.removed).toEqual(['b']);
    expect(afterDelete.entries.some((e) => afterDelete.removed.includes(e.id))).toBe(false);

    // 복원은 삭제 기록을 비운다 — 그 뒤에도 겹침이 생기지 않아야 한다.
    replaceEntries([entry('b', '2026-03-02'), entry('c', '2026-03-03')], storage, 2000);
    const afterRestore = loadState(storage);
    expect(afterRestore.removed).toEqual([]);
    expect(afterRestore.entries.map((e) => e.id).sort()).toEqual(['b', 'c']);
  });

  it('다른 탭이 복원으로 목록을 대체하면 오래된 화면의 저장이 물러난다', () => {
    saveState({ ...emptyState(), entries: [entry('old', '2026-03-01')] }, storage);
    replaceEntries([entry('kept', '2026-03-05')], storage, 5000);
    // 복원 전에 열린 탭: 자기 화면에는 'kept' 이 없고 'old' 를 지우려 했던 기억이 있다.
    const stale = saveEntries([entry('old', '2026-03-01')], ['kept'], storage, 4000);
    expect(stale.superseded).toBe(true);
    expect(stale.ok).toBe(false);
    expect(stale.merged.map((e) => e.id)).toEqual(['kept']);
    expect(stale.removed).toEqual([]);
    expect(stale.restoreAt).toBe(5000);
    // 저장소는 복원된 그대로 — 되살아난 행도, 지워진 행도 없다.
    expect(liveIds()).toEqual(['kept']);
    // 같은 화면이 새 세대를 받아들인 뒤에는 저장이 다시 동작한다.
    const next = saveEntries([entry('kept', '2026-03-05'), entry('fresh', '2026-03-06')], [], storage, stale.restoreAt);
    expect(next.superseded).toBe(false);
    expect(next.ok).toBe(true);
    expect(liveIds()).toEqual(['fresh', 'kept']);
  });

  it('restoreAt 는 저장본에서 읽고, 형식이 이상하면 없는 것으로 다룬다', () => {
    replaceEntries([entry('a', '2026-03-01')], storage, 12345);
    expect(loadState(storage).restoreAt).toBe(12345);
    storage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 3, entries: [], restoreAt: 'x' }));
    expect(loadState(storage).restoreAt).toBeNull();
    storage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 3, entries: [] }));
    expect(loadState(storage).restoreAt).toBeNull();
  });

  it('읽기는 삭제 기록을 자르지 않는다 (저장된 것만큼 기억한다)', () => {
    const many = Array.from({ length: MAX_TOMBSTONES + 3 }, (_, i) => `x${i}`);
    storage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 3, entries: [entry('live', '2026-03-01')], removed: many }));
    expect(readStored(storage).state.removed).toHaveLength(MAX_TOMBSTONES + 3);
    // 쓰기가 붙일 때만 상한이 적용되고, 잘린 개수를 돌려준다.
    const res = saveEntries([entry('live', '2026-03-01')], ['new-1'], storage);
    expect(res.removed).toHaveLength(MAX_TOMBSTONES);
    expect(res.trimmed).toBe(4);
  });

  it('쓰기에 실패한 비우기는 삭제 기록을 늘리지 않는다', () => {
    saveState({ ...emptyState(), entries: [entry('a', '2026-03-01')] }, storage);
    // 저장소는 그대로 두고, 이후 쓰지만 실패하게 만든다(용량 초과·시크릿 모드 흉내).
    (storage as unknown as { setItem: (k: string, v: string) => void }).setItem = () => {
      throw new Error('QuotaExceeded');
    };
    const res = clearEntries(storage);
    expect(res.ok).toBe(false);
    expect(res.removed).toEqual([]);
    expect(res.trimmed).toBe(0);
    // 실패한 저장도 화면에 새 삭제 기록을 남기지 않는다.
    const failed = saveEntries([], ['a'], storage);
    expect(failed.ok).toBe(false);
    expect(failed.trimmed).toBe(0);
  });
});
