// @ts-check
/**
 * 빌드 결과(dist) 점검. 소스 코드 검사로는 잡히지 않는 "실제로 배포된 파일" 단위의 확인을 합니다.
 *   1) 페이지 간 내부 링크가 전부 실제 html 로 존재한다 (404 로 나가는 링크 차단)
 *   2) 모든 화면의 <title> 에 (비공식) 이 들어 있다 (공식 기관 페이지로 오해될 여지 차단)
 *   3) 모든 화면에 canonical 이 1개, base 경로가 붙어 있다
 *
 * 사용: npm run build && node scripts/check-dist.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DIST = join(ROOT, 'dist');

/**
 * @param {string} dir
 * @returns {string[]}
 */
function walk(dir) {
  /** @type {string[]} */
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

let files;
try {
  files = walk(DIST);
} catch {
  console.error('dist 가 없습니다. npm run build 를 먼저 실행하세요.');
  process.exit(1);
}
const html = files.filter((f) => f.endsWith('.html'));
if (html.length === 0) {
  console.error('dist 안에 html 파일이 없습니다.');
  process.exit(1);
}
const relSet = new Set(files.map((f) => posix.relative(DIST, f).replace(/\\/g, '/')));

// base 는 빌드 결과에서 읽어옵니다(로컬 빌드는 base 가 '/' ). 따옴표를 넘겨 읽으면 안 되므로 [^"] 로 묶습니다.
const indexText = readFileSync(join(DIST, 'index.html'), 'utf8');
const baseMatch = /href="([^"]*?)\/favicon\.svg"/.exec(indexText);
if (!baseMatch) {
  console.error('dist/index.html 에서 favicon 링크를 찾지 못해 base 를 결정할 수 없습니다.');
  process.exit(1);
}
const base = baseMatch[1] + '/';

/**
 * 링크 href 를 dist 안 실제 파일 경로로 되역합니다.
 * @param {string} href
 * @returns {string | null | undefined} 대상 존재 시 경로, base 밖이면 null, 없으면 undefined
 */
function resolve(href) {
  if (!href.startsWith(base)) return null;
  let p = href.slice(base.length).split('?')[0].split('#')[0];
  if (p.endsWith('/')) p += 'index.html';
  if (p === '') p = 'index.html';
  if (relSet.has(p)) return p;
  if (relSet.has(p + '/index.html')) return p + '/index.html';
  if (relSet.has(p + '.html')) return p + '.html';
  return undefined;
}

const problems = [];
let linkCount = 0;
for (const f of html) {
  const rel = posix.relative(DIST, f).replace(/\\/g, '/');
  const text = readFileSync(f, 'utf8');

  const title = /<title>([\s\S]*?)<\/title>/.exec(text);
  if (!title) problems.push(`${rel}: <title> 이 없습니다`);
  else if (!title[1].includes('(비공식)')) problems.push(`${rel}: 제목에 (비공식) 표기가 없습니다 → ${title[1].trim()}`);

  const canonicals = text.match(/<link rel="canonical"/g) || [];
  if (canonicals.length !== 1) problems.push(`${rel}: canonical 이 ${canonicals.length}개 입니다(1개여야 합니다)`);
  /**
   * canonical 의 base 중복 부착 검사. 화면이 자체적으로 p() 를 거쳐 만든 경로를 Base 레이아웃에 넘기면
   * 절대 URL 이 한 번 더 감싸서 /startup-help/startup-help/ 가 됩니다(실제로 /start/·/consult/ 에서 발생).
   * 내부 링크는 resolve() 가 잡아도 canonical 은 잡지 못하므로 여기서 따로 봅니다.
   */
  const canonicalHref = /<link rel="canonical" href="([^"]*)"/.exec(text)?.[1] ?? '';
  if (!canonicalHref) {
    problems.push(`${rel}: canonical href 를 읽을 수 없습니다`);
  } else {
    const seg = base.replace(/^\/+|\/+$/g, '');
    if (seg) {
      const pathname = canonicalHref.replace(/^[a-z]+:\/\/[^/]+/i, '');
      const needle = `/${seg}/`;
      // split 은 앞뒤로 겹치는 조각을 삼켜버립니다('/startup-help//…' 는 split 만으로는 1 번으로 보입니다).
      // 그래서 한 글자씩 밀면서 세어, /startup-help/startup-help/start/ 를 2 번으로 잡습니다.
      let times = 0;
      for (let at = pathname.indexOf(needle); at !== -1; at = pathname.indexOf(needle, at + 1)) times++;
      if (times > 1)
        problems.push(`${rel}: canonical 에 base 가 ${times}번 붙었습니다(한 번이어야 합니다) → ${canonicalHref}`);
    }
  }

  for (const m of text.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const href = m[1];
    if (/^(https?:|mailto:|tel:|data:|#)/.test(href)) continue;
    if (!href.startsWith('/')) continue; // 상대 경로는 이 사이트 구조에서 쓰지 않습니다
    if (href.startsWith('//')) continue; // 프로토콜 상대 URL
    linkCount++;
    const hit = resolve(href);
    if (hit === null) problems.push(`${rel}: base 밖으로 나가는 링크 → ${href}`);
    else if (hit === undefined) problems.push(`${rel}: 존재하지 않는 대상 → ${href}`);
  }
}

if (problems.length) {
  console.error(`빌드 결과 검사 실패 (내부 링크 ${linkCount}건 확인):\n` + [...new Set(problems)].map((p) => '  - ' + p).join('\n'));
  process.exit(1);
}

console.log(`빌드 결과 검사 통과: 페이지 ${html.length}개, 내부 링크 ${linkCount}건, base ${base}`);
