// @ts-check
import { defineConfig } from 'astro/config';

import { prefixRootLinks } from './src/plugins/baseLinks.js';

// GitHub Pages 프로젝트 사이트로 배포합니다.
// 리포 이름이나 도메인이 바뀌면 아래 base / site 도 함께 고쳐야 합니다.
// 예) 커스텀 도메인 사용 시 → base: '/', site: 'https://example.com'
const REPO = 'startup-help';
const BASE = `/${REPO}/`;
const isLocal = process.env.ASTRO_LOCAL === '1';

export default defineConfig({
  output: 'static',
  site: isLocal ? 'http://localhost:4321' : `https://proxsolver.github.io${BASE}`,
  base: isLocal ? '/' : BASE,
  trailingSlash: 'ignore',
  markdown: {
    // 본문 마크다운의 루트 절대경로 링크(/guide/...)에 배포 base 경로를 붙입니다.
    rehypePlugins: [[prefixRootLinks, { base: isLocal ? '/' : BASE }]]
  },
  build: {
    inlineStylesheets: 'auto'
  },
  prefetch: {
    prefetchAll: true
  }
});
