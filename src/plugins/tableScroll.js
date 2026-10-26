// @ts-check
/**
 * rehype plugin: 마크다운 본문 표를 `<div class="table-scroll">` 로 감싼다.
 *
 * 이유 — 좁은 화면에서 표는 감싸는 블록이 없으면 스크롤되는 대신 열을 찌그러뜨립니다.
 * 4열 표를 360px 에 넣으면 첫 열이 41px 까지 줄어 두 글자씩 잘려 쌓이고,
 * 6열 표(캘린더)는 한 칸이 161줄까지 늘어났습니다(실측). 그래서 스크롤 컨테이너를
 * 열수와 무관하게 항상 만들어 두고, 넓은 표만 CSS 로 최소 너비를 준 뒤 나머지는 밀어 넘기게 합니다.
 *
 * 열 4개 이상 표에는 안내 문장 하나를 앞에 붙이고, 그보다 적은 표는 래퍼만 감쌉니다.
 * 컴포넌트 쪽 표는 이 플러그인을 지나지 않습니다(마크다운 본문만 대상) — 같은 클래스로 직접 감겨 있습니다.
 * 마크다운 안에 손으로 쓴 <div class="table-scroll"> 는 걸러지지 않습니다. Astro 가 사용자 플러그인을
 * 원시 HTML 되살림(rehype-raw)보다 먼저 돌려, 그 단계에서 부모가 div 로 보이지 않기 때문입니다.
 * 그래서 본문에서는 감싸지 않는 것이 규칙이고, 아래 부모 검사는 되풀이 래퍼를 만드는 실수를 줄이기 위한 최소 방어입니다.
 *
 * 고쳐도 화면이 그대로일 수 있습니다 — Astro 콘텐츠 레이어는 이 플러그인의 결과를 마크다운과 같이 캐시합니다.
 * 캐시는 콘텐츠 파일이 바뀐 것만 감지하므로, 이 파일만 고쳤을 때는 `node_modules/.astro/data-store.json` 을 지운 뒤
 * 다시 빌드해야 새 결과가 화면에 나옵니다.
 */
export function wrapTables() {
  /** @param {any} tree */
  return function transformer(tree) {
    visit(tree);
  };

  /** @param {any} node */
  function visit(node) {
    if (!node || typeof node !== 'object' || !Array.isArray(node.children)) return;
    const children = [...node.children];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child && child.type === 'element' && child.tagName === 'table') {
        const alreadyWrapped = node.type === 'element' && node.tagName === 'div' && hasScrollClass(node);
        if (!alreadyWrapped) {
          const at = node.children.indexOf(child);
          const wrapper = {
            type: 'element',
            tagName: 'div',
            properties: { className: ['table-scroll'] },
            children: [child]
          };
          // 열이 4개 이상이면 최소 너비 규칙 때문에 표가 컨테이너보다 넓어집니다(360px 실측).
          // 본문 마크다운에는 안내를 손으로 넣을 수 없으니 여기서 함께 붙입니다 —
          // 좁은 화면에서는 표가 밀린다는 사실을 보여야 알 수 있습니다.
          // 열수를 data-cols 로 남기는 이유: 안내는 「표가 실제로 밀리는 폭까지만」 보여야 하는데,
          // 그 폭이 열 수(= --tw-* 값)에서 나오기 때문입니다. 손으로 적으면 표가 한 열 늘었을 때 틀립니다.
          const cols = headerCellCount(child);
          const insert = cols >= 4 ? [hint(cols), wrapper] : [wrapper];
          node.children.splice(at, 1, ...insert);
        }
      }
      visit(child);
    }
  }
}

/** 안내 문장 하나를 만듭니다. @param {number} cols */
function hint(cols) {
  return {
    type: 'element',
    tagName: 'p',
    properties: { className: ['small', 'muted', 'scroll-hint', 'no-print'], 'data-cols': String(cols) },
    children: [{ type: 'text', value: '표가 화면보다 넓어지면 좌우로 밀어 보세요. 인쇄에는 잘리지 않습니다.' }]
  };
}

/** 헤더 행의 열 개수. thead 가 없으면 첫 행을 봅니다. */
/** @param {any} table
 *  @returns {number} */
function headerCellCount(table) {
  /** @param {any} node
   *  @returns {any[]} */
  const kids = (node) => (Array.isArray(node?.children) ? node.children : []);
  const thead = kids(table).find((node) => node && node.tagName === 'thead');
  const row = kids(thead || table).find((node) => node && node.tagName === 'tr');
  return kids(row).filter((node) => node && node.tagName === 'th').length;
}

/** @param {any} node */
function hasScrollClass(node) {
  const value = node?.properties?.className;
  if (typeof value === 'string') return value.split(/\s+/).includes('table-scroll');
  if (Array.isArray(value)) return value.includes('table-scroll');
  return false;
}
