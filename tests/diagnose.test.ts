import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  answerLabels,
  checklistItemsForStage,
  diagnosisSummary,
  nextSteps,
  type BlockAnswer,
  type HaveAnswer,
  type StageAnswer
} from '../src/lib/diagnose';
import { CATEGORY_META } from '../src/data/categories';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/**
 * 이 사이트에 실제로 존재하는 라우트. 진단이 가리키는 주소가 전부 여기 있게 해야 합니다.
 * (정적 라우트 + 문서 라우트 + 분류 목록 라우트 — 없는 주소를 걸면 check:dist 가 빌드에서 잡지만,
 *  여기서 먼저 걸면 원문이 어디인지 테스트가 말합니다)
 * @returns {Set<string>}
 */
function realRoutes(): Set<string> {
  const routes = new Set<string>();
  /** @param {string} dir @param {string} prefix */
  const walk = (dir: string, prefix: string) => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) {
        walk(abs, `${prefix}${name}/`);
        continue;
      }
      if (!/\.(astro|md)$/.test(name)) continue;
      if (name.startsWith('[')) continue; // 동적 세그먼트는 아래에서 따로 펴냅니다
      const stem = name.replace(/\.(astro|md)$/, '');
      if (stem === 'index') routes.add(prefix || '/');
      else if (stem === '404') routes.add('/404/');
      else routes.add(`${prefix}${stem}/`);
    }
  };
  walk(join(ROOT, 'src', 'pages'), '/');
  walk(join(ROOT, 'src', 'content', 'guides'), '/guide/');
  for (const c of CATEGORY_META) routes.add(`/guide/${c.key}/`);
  return routes;
}

const STAGES: StageAnswer[] = ['before', 'execute', 'settle'];
const BLOCKS: BlockAnswer[] = ['evidence', 'deadline', 'amounts', 'format'];
const HAVES: HaveAnswer[] = ['card', 'mixed', 'none'];

describe('3문 진단 → 다음에 할 일', () => {
  it('가능한 모든 답 조합에서 경로 4개 이하로 돌려준다', () => {
    for (const stage of STAGES) {
      for (const block of BLOCKS) {
        for (const have of HAVES) {
          const steps = nextSteps({ stage, block, have });
          expect(steps.length).toBeGreaterThan(0);
          expect(steps.length).toBeLessThanOrEqual(4);
          expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
        }
      }
    }
  });

  it('가리키는 주소는 전부 이 사이트에 실제로 존재한다', () => {
    const known = realRoutes();
    const seen = new Map<string, string>();
    for (const stage of STAGES) {
      for (const block of BLOCKS) {
        for (const have of HAVES) {
          for (const s of nextSteps({ stage, block, have })) seen.set(s.href, s.id);
        }
      }
    }
    // 진단이 쓰는 주소가 목록에 하나도 없으면 테스트가 무의미하니 미리 확인합니다.
    expect(seen.size).toBeGreaterThan(6);
    for (const [href, id] of seen) expect(known.has(href), `${id} → ${href}`).toBe(true);
  });

  it('답이 빠지거나 엉뚱한 값이 와도 기본 동선으로 돌아간다', () => {
    const fallback = nextSteps({});
    expect(fallback.length).toBeGreaterThan(0);
    const junk = nextSteps({ stage: 'nope' as StageAnswer, block: '' as BlockAnswer, have: undefined });
    expect(junk.map((s) => s.id)).toEqual(fallback.map((s) => s.id));
  });

  it('증빙 막힘은 미수취 되돌리기를, 제출 형식 막힘은 꾸러미를 먼저 권한다', () => {
    expect(nextSteps({ stage: 'execute', block: 'evidence', have: 'none' }).map((s) => s.id)).toContain('missing-voucher');
    expect(nextSteps({ block: 'format', have: 'none' })[0].id).toBe('settlement-package');
  });

  it('카드 위주면 카드사 창구를, 종류가 섞이면 발급 창구를 권한다', () => {
    expect(nextSteps({ block: 'evidence', have: 'card' }).map((s) => s.id)).toContain('card-records');
    expect(nextSteps({ block: 'amounts', have: 'mixed' }).map((s) => s.id)).toContain('issuing-channels');
  });

  it('아직 아무것도 없으면 체크리스트 도구로 끝까지 간다', () => {
    expect(nextSteps({ stage: 'settle', block: 'deadline', have: 'none' }).map((s) => s.id)).toContain('checklist-tool');
  });

  it('각 항목은 제목과 이유를 함께 갖는다', () => {
    for (const s of nextSteps({ stage: 'before', block: 'deadline', have: 'mixed' })) {
      expect(s.title.trim().length).toBeGreaterThan(1);
      expect(s.why.trim().length).toBeGreaterThan(1);
    }
  });
});

describe('진단 요약 문장', () => {
  it('세 답을 사람 읽는 한 줄로 붙인다', () => {
    expect(diagnosisSummary({ stage: 'before', block: 'amounts', have: 'card' })).toBe('집행 전 · 막힌 곳: 금액이 정리되지 않는다 · 가진 것: 카드전표 위주');
  });

  it('라벨 표는 답 값 전체를 덮는다', () => {
    const labels = answerLabels();
    for (const v of [...STAGES, ...BLOCKS, ...HAVES]) expect(labels[v], v).toBeTruthy();
  });
});

describe('단계별 체크리스트 연결', () => {
  it('세 진단 단계가 모두 실제 체크리스트 항목 덩어리를 만난다', () => {
    for (const stage of STAGES) {
      const items = checklistItemsForStage(stage);
      expect(items.length).toBeGreaterThan(0);
      for (const i of items) expect(i.label.trim().length).toBeGreaterThan(0);
    }
  });

  it('모르는 단계는 기본 단계(집행 중) 항목으로 돌려준다', () => {
    expect(checklistItemsForStage('nope' as StageAnswer)).toEqual(checklistItemsForStage('execute'));
  });
});
