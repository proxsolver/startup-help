// @ts-check
/**
 * 콘텐츠 게이트. 게시 전에 아래를 검사하고 하나라도 걸리면 실패시킵니다.
 *   1) 모든 문서에 공식 출처 링크(sources)가 1개 이상 있다
 *   2) verification: pending 인 문서에 검증 메모가 있다
 *   3) pending 문서가 법적 수치·제재 표현(만원/억원/가산세/제N조/N년 보존)을 본문에 쓰지 않았다
 *   4) 문서 안의 내부 링크(/guide/..., /tools/... 등)가 실제 라우트로 존재한다
 *   5) 본문에 한자·가나 섞임(drift)이 없다 — 한국어 사이트에서 섞이는 사고를 빌드에서 잡는다
 *
 * 사용: node scripts/check-content.mjs   (npm run check:content)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const README = join(ROOT, 'README.md');
const CONTENT = join(ROOT, 'src', 'content', 'guides');
const STATIC_ROUTES = [
  '/',
  '/guide/',
  '/calendar/',
  '/tools/receipts/',
  '/tools/checklist/',
  '/about/',
  '/privacy/',
  '/terms/',
  '/disclaimer/',
  '/404/'
];

/** @returns {{path:string, text:string, fm:string, body:string}[]} */
function collect(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...collect(p));
    else if (name.endsWith('.md')) {
      const text = readFileSync(p, 'utf8');
      const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
      out.push({ path: p, text, fm: m ? m[1] : '', body: m ? m[2] : text });
    }
  }
  return out;
}

const files = collect(CONTENT);
const ids = files.map((f) => {
  const rel = f.path.slice(CONTENT.length + 1).replace(/\\/g, '/').replace(/\.md$/, '');
  return '/guide/' + rel + '/';
});
const known = new Set([...STATIC_ROUTES, ...ids]);

const FORBIDDEN_WHILE_PENDING = [
  { re: /\d+\s*만원/, why: '금액 한도' },
  { re: /\d+\s*억원/, why: '금액 기준' },
  { re: /가산세/, why: '제재 표현' },
  { re: /제\s?\d+조/, why: '법령 조항 인용' },
  { re: /\d+\s*년\s*(간\s*)?보존|보존기간\s*(은|이)?\s*\d/, why: '보존기간 수치' },
  { re: /기한은\s*\d+/, why: '기한 수치' }
];

const DRIFT = /[\u3040-\u30ff\u4e00-\u9fff]/g;

const problems = [];
for (const f of files) {
  const rel = posix.relative(join(ROOT, 'src'), f.path);
  const hasSources = /sources:\s*\n(?:\s*-\s+label:.*\n\s*url:\s*'?\S+'?\n)/.test(f.fm) || /url:\s*['"]https?:\/\//.test(f.fm);
  if (!hasSources) problems.push(`${rel}: 공식 출처(sources)가 없습니다`);

  const pending = /verification:\s*pending/.test(f.fm);
  if (pending && !/verificationNote:/.test(f.fm)) problems.push(`${rel}: pending 인데 verificationNote 이 없습니다`);

  if (pending) {
    for (const { re, why } of FORBIDDEN_WHILE_PENDING) {
      const m = re.exec(f.body);
      if (m) problems.push(`${rel}: 검증 대기 문서에 ${why}("…${m[0]}…") 가 있습니다`);
    }
  }

  for (const m of f.body.matchAll(/\]\((\/[^)\s]+)\)/g)) {
    const href = m[1];
    if (!href.startsWith('/guide/') && !href.startsWith('/tools/') && !href.startsWith('/calendar/') && !href.startsWith('/about/')) continue;
    const norm = href.endsWith('/') ? href : href + '/';
    if (!known.has(norm)) problems.push(`${rel}: 존재하지 않는 내부 링크 ${href}`);
  }

  const drift = f.text.match(DRIFT);
  if (drift) problems.push(`${rel}: 한국어가 아닌 문자가 섞였습니다 → ${[...new Set(drift)].join(' ')}`);
}

if (problems.length) {
  console.error('콘텐츠 검사 실패:\n' + problems.map((p) => '  - ' + p).join('\n'));
  process.exit(1);
}

/**
 * 문서뿐 아니라 컴포넌트·테스트·설정에서도 한자/가나 섞임을 잡는다.
 * (한국어 사이트 작성 중 모델·편집 실수로 섞여 들어가는 사고를 CI에서 영구 차단)
 */
const DRIFT_TARGETS = ['src', 'tests', 'scripts', 'public', '.github'];
const DRIFT_FILES = [README];
function* walkText(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.astro') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walkText(p);
    else if (/\.(astro|ts|js|mjs|md|yml|yaml|css|json|svg)$/.test(name)) yield p;
  }
}
const driftProblems = [];
for (const dir of DRIFT_TARGETS) {
  const abs = join(ROOT, dir);
  try {
    for (const file of walkText(abs)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const hit = line.match(DRIFT);
        if (hit) driftProblems.push(`${posix.relative(ROOT, file)}:${i + 1} → ${[...new Set(hit)].join(' ')}`);
      });
    }
  } catch {
    /* 없는 폴더는 넘긴다 */
  }
}
for (const file of DRIFT_FILES) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const hit = line.match(DRIFT);
    if (hit) driftProblems.push(`${posix.relative(ROOT, file)}:${i + 1} → ${[...new Set(hit)].join(' ')}`);
  });
}
if (driftProblems.length) {
  console.error('한국어 아닌 문자 섞임 발견:\n' + driftProblems.map((p) => '  - ' + p).join('\n'));
  process.exit(1);
}

console.log(`콘텐츠 검사 통과: 문서 ${files.length}건`);
