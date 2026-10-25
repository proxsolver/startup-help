// @ts-check
/**
 * rehype plugin: 마크다운 본문 표를 `<div class="table-scroll">` 로 감싼다.
 *
 * 이유 — 좁은 화면에서 표는 감싸는 블록이 없으면 스크롤되는 대신 열을 찌그러뜨립니다.
 * 4열 표를 360px 에 넣으면 첫 열이 41px 까지 줄어 두 글자씩 잘려 쌓이고,
 * 6열 표(캘린더)는 한 칸이 161줄까지 늘어났습니다(실측). 그래서 스크롤 컨테이너를
 * 열수와 무관하게 항상 만들어 두고, 넓은 표만 CSS 로 최소 너비를 준 뒤 나머지는 밀어 넘기게 합니다.
 *
 * 컴포넌트 쪽 표는 이미 같은 클래스로 감겨 있어, 부모가 이미 .table-scroll 이면 건너뜁니다.
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
          const wrapper = {
            type: 'element',
            tagName: 'div',
            properties: { className: ['table-scroll'] },
            children: [child]
          };
          node.children[node.children.indexOf(child)] = wrapper;
        }
      }
      visit(child);
    }
  }
}

/** @param {any} node */
function hasScrollClass(node) {
  const value = node?.properties?.className;
  if (typeof value === 'string') return value.split(/\s+/).includes('table-scroll');
  if (Array.isArray(value)) return value.includes('table-scroll');
  return false;
}
