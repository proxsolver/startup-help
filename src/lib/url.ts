/**
 * 배포 base 경로를 고려한 내부 링크 생성.
 * 마크다운 본문은 src/plugins/baseLinks.js 가 처리하고, .astro / 클라이언트 스크립트는 이 헬퍼를 씁니다.
 */
const rawBase = (import.meta.env.BASE_URL ?? '/').replace(/\/+$/, '');

export const BASE_PATH = rawBase;

export function p(path: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path) || path.startsWith('#') || path.startsWith('mailto:')) {
    return path;
  }
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${rawBase}${clean}`;
}

/** 절대 URL(canonical, og:url) 용도. Astro.site 값과 결합합니다. */
export function absoluteUrl(site: URL | undefined, path: string): string | undefined {
  if (!site) return undefined;
  return new URL(p(path), site).toString();
}
