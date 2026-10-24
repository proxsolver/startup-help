import { beforeEach, describe, expect, it } from 'vitest';
import {
  STORAGE_KEY,
  backupFileName,
  clearState,
  emptyState,
  getStorage,
  loadState,
  normalizeState,
  parseBackup,
  saveState,
  serializeState
} from '../src/lib/storage';
import { SCHEMA_VERSION } from '../src/lib/receipts';

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
      checklist: { 'pre-01': true, 'pre-02': 'yes', n: 3 }
    });
    expect(state.entries).toHaveLength(1);
    expect(dropped).toBe(2);
    expect(state.checklist).toEqual({ 'pre-01': true });
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
    state.entries.push({ id: 'a', date: '2026-03-01', vendor: 'A', amount: 5000, payMethod: '현금', evidenceType: '현금영수증', category: '기타', memo: '' });
    state.checklist['pre-01'] = true;
    expect(saveState(state, storage)).toBe(true);
    const back = loadState(storage);
    expect(back.entries[0].vendor).toBe('A');
    expect(back.checklist['pre-01']).toBe(true);
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
    state.entries.push({ id: 'z', date: '2026-01-09', vendor: '택배', amount: 3000, payMethod: '계좌이체', evidenceType: '없음', category: '교통·출장', memo: '샘플' });
    const { state: restored, dropped } = parseBackup(serializeState(state));
    expect(dropped).toBe(0);
    expect(restored.entries[0].memo).toBe('샘플');
    expect(restored.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('형식이 다른 파일은 빈 상태로', () => {
    expect(parseBackup('not json').state.entries).toEqual([]);
  });

  it('백업 파일명에 날짜가 들어간다', () => {
    expect(backupFileName(new Date('2026-03-31T12:00:00Z'))).toBe('startup-help-backup_20260331.json');
  });
});
