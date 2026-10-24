// @ts-check
/**
 * rehype plugin: 마크다운 본문에 쓰인 루트 절대경로 링크에 배포 base 경로를 붙인다.
 * 마크다운에는 `/guide/receipts/...` 처럼 사이트 루트 기준으로만 적어 두고,
 * GitHub Pages 프로젝트 사이트의 `/startup-help/` 앞경로를 여기서 채운다.
 * 의존성 없이 hast 트리를 직접 순회한다.
 */

/** @param {{ base?: string }} [options] */
export function prefixRootLinks(options = {}) {
  const base = options.base ?? '/';
  const prefix = base === '/' ? '' : base.replace(/\/+$/, '');
  if (!prefix) return () => undefined;

  /** @param {any} tree */
  return function transformer(tree) {
    walk(tree);
  };

  /** @param {any} node */
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    const props = node.properties;
    if (props) {
      for (const key of ['href', 'src']) {
        const value = props[key];
        if (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')) {
          props[key] = prefix + value;
        }
      }
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child);
    }
  }
}
