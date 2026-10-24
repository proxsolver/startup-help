// @ts-check
/**
 * 콘텐츠 게이트. 게시 전에 아래를 검사하고 하나라도 걸리면 실패시킵니다.
 *   1) 모든 문서에 공식 출처 링크(sources)가 1개 이상 있다 (도메인은 공공 기관 영역으로 제한)
 *   2) verification: pending 인 문서에 검증 메모가 있다 — 기본값이 pending 이므로 verification 을
 *      아예 적지 않으면 pending 으로 취급되어 메모 요구·수치 금지가 함께 걸립니다
 *   3) pending 문서가 법적 수치·제재 표현(만원/억원/가산세/제N조/N년 보존/기한 수치)을 쓰지 않았다
 *      (본문뿐 아니라 frontmatter 도 함께 봅니다)
 *   4) 문서 안의 내부 링크(/guide/..., /tools/... 등)가 실제 라우트로 존재한다
 *   5) 본문에 한자·가나 섞임(drift)이 없다 — 한국어 사이트에서 섞이는 사고를 빌드에서 잡는다
 *   6) 컴포넌트·데이터 코드에 적힌 링크도 실제 라우트인지 검사한다(주석 속 예시는 제외)
 *   7) 화면에 찍히는 게시 데이터(src/data/schedule.ts)도 같은 규칙을 따른다 — pending 항목은
 *      시점 칸을 채울 수 없고, 설명에 검증 안 된 수치를 쓰지 못하며, 확인 창구 링크와
 *      '값이 확정되는 자리(decidedBy)' 를 반드시 갖는다. verification 칸도 반드시 적는다(빠지면 실패).
 *   8) pending → verified 로 값만 바꾸면 위 수치 금지가 전부 풀린다. 그래서 검증 완료 문서·항목은
 *      수치·조항을 적는 경우 그 자리에서 다시 확인할 수 있는 원문 링크(law·nts·hometax)와
 *      제N조 인용 시 국가법령정보센터 링크를 함께 요구한다. 링크가 이 사이트(self)뿐이면
 *      '자체 권장'임이 드러나 있는지 본다 — 기관 요구로 오해되면 안 됩니다.
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

/**
 * @param {string} dir
 * @returns {{path:string, text:string, fm:string, body:string}[]}
 */
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

// 분류 목록 페이지(/guide/<category>/) 도 실제 라우트입니다.
// 라우트는 src/pages/guide/[category]/index.astro 의 getStaticPaths(CATEGORY_META) 에서 나오므로,
// 그 키를 데이터 파일에서 읽어 함께 등록합니다. (문서가 없는 분류도 라우트는 존재한다)
const categoriesSource = readFileSync(join(ROOT, 'src', 'data', 'categories.ts'), 'utf8');
const categoryKeys = new Set([...categoriesSource.matchAll(/key:\s*'([a-z_]+)'/g)].map((m) => m[1]));
for (const f of files) {
  const m = /^category:\s*'?([a-z_]+)'?/m.exec(f.fm);
  if (m) categoryKeys.add(m[1]);
}
const categoryRoutes = [...categoryKeys].map((c) => `/guide/${c}/`);

const known = new Set([...STATIC_ROUTES, ...ids, ...categoryRoutes]);

const FORBIDDEN_WHILE_PENDING = [
  // 주의: 한국어는 JS 정규식에서 \w 가 아니라서 \b 를 붙이면 '원'·'일' 뒤에서 절대 매칭되지 않습니다.
  { re: /\d[\d,]*\s*원/, why: '원 단위 금액' },
  { re: /\d\s*만원/, why: '금액 한도' },
  { re: /\d\s*억원/, why: '금액 기준' },
  { re: /[일이삼사오육칠팔구십]+만원/, why: '한글 수량 금액' },
  { re: /가산세/, why: '제재 표현' },
  { re: /제\s?\d+조/, why: '법령 조항 인용' },
  { re: /\d+\s*년\s*(간\s*)?(보관|보존)|\d+\s*년간\s*(보관|보존)/, why: '보존·보관기간 수치' },
  { re: /\d+\s*월\s*\d+\s*일/, why: '날짜 기한' },
  { re: /\d+\s*[.]\s*\d+\s*[.]\s*\d+/, why: '날짜 기한' },
  { re: /기한은\s*\d+|\d+\s*(일|개월)\s*(이내|안에|까지)/, why: '기한 수치' }
];

/** 본문에 법적 수치·조항이 있는지 보는 패턴 (verified 문서의 출처 강요용) */
const LEGAL_FIGURE = [/제\s?\d+조/, /\d\s*(만원|억원)/, /\d+\s*년\s*(간\s*)?(보관|보존)/, /\d+\s*월\s*\d+\s*일/];
/** 독자가 그 자리에서 다시 확인할 수 있는 출처(법령 원문·국세청) */
const RECHECK_HOSTS = /(^|\.)(law\.go\.kr|nts\.go\.kr|hometax\.go\.kr)$/i;

const DRIFT = /[\u3040-\u30ff\u4e00-\u9fff]/g;

/** @type {string[]} */
const problems = [];
for (const f of files) {
  const rel = posix.relative(join(ROOT, 'src'), f.path);
  const hasSources = /sources:\s*\n(?:\s*-\s+label:.*\n\s*url:\s*'?\S+'?\n)/.test(f.fm) || /url:\s*['"]https?:\/\//.test(f.fm);
  if (!hasSources) problems.push(`${rel}: 공식 출처(sources)가 없습니다`);
  // 출처로 적을 수 있는 도메인은 공공 기관 영역으로 제한합니다(블로그·기사 인용 방지).
  const sourceUrls = [...f.fm.matchAll(/url:\s*['"]?(https?:\/\/[^\s'"]+)/g)].map((m) => m[1]);
  for (const u of sourceUrls) {
    let host = '';
    try {
      host = new URL(u).hostname;
    } catch {
      problems.push(`${rel}: 출처 URL 형식이 올바르지 않습니다 → ${u}`);
      continue;
    }
    if (!/(^|\.)(go\.kr|or\.kr|gov\.kr|law\.go\.kr)$/i.test(host)) {
      problems.push(`${rel}: 출처 도메인이 공공 기관 영역이 아닙니다 → ${host}`);
    }
  }

  // 스키마 기본값이 'pending' 이므로 verified 라고 적힌 경우만 검증 완료로 봅니다(따옴표 허용).
  const pending = !/verification:\s*['"]?verified['"]?/.test(f.fm);
  if (pending && !/verificationNote:/.test(f.fm)) problems.push(`${rel}: pending 인데 verificationNote 이 없습니다`);

  if (pending) {
    for (const { re, why } of FORBIDDEN_WHILE_PENDING) {
      // 본문뿐 아니라 frontmatter(summary 는 목록 카드에 그대로 노출)도 함께 봅니다.
      const m = re.exec(f.text);
      if (m) problems.push(`${rel}: 검증 대기 문서에 ${why}("…${m[0]}…") 가 있습니다`);
    }
  } else {
    // pending → verified 로 값만 바꾸면 수치 금지가 전부 풀립니다. 그래서 검증 완료 문서에는
    // 그 수치를 그 자리에서 다시 확인할 수 있는 출처를 요구합니다(법령 원문·국세청·홈택스).
    const figures = LEGAL_FIGURE.map((re) => {
      const m = re.exec(f.text);
      return m ? m[0] : '';
    }).filter((s) => s !== '');
    const hosts = sourceUrls.map((u) => {
      try {
        return new URL(u).hostname;
      } catch {
        return '';
      }
    });
    const recheckable = hosts.some((h) => RECHECK_HOSTS.test(h));
    if (figures.length > 0 && !recheckable) {
      problems.push(
        `${rel}: 검증 완료 문서에 수치·조항(${figures.join(', ')})이 있는데 다시 확인할 수 있는 출처(law.go.kr·nts.go.kr·hometax.go.kr)가 없습니다 — 확인한 원문 링크를 sources 에 넣으세요`
      );
    }
    if (/제\s?\d+조/.test(f.text) && !hosts.some((h) => /(^|\.)law\.go\.kr$/i.test(h))) {
      problems.push(`${rel}: 조항(제N조)을 적으면서 국가법령정보센터 원문 링크가 없습니다 — 인용한 법령 링크를 sources 에 넣으세요`);
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
 * 6) 코드·데이터 파일에 적힌 내부 링크도 실제 라우트인지 검사합니다.
 *    (문서 본문 밖의 링크 — checklists.ts 의 guide:, 컴포넌트의 href — 가 사라진 경로로 남는 사고 방지)
 *    설명용 예시(주석 안의 경로)와 템플릿 리터럴로 id 를 조립하는 곳은 판정할 수 없어 건너뜁니다.
 */
const CODE_LINK = /["'`](\/(?:guide|tools|calendar|about|privacy|terms|disclaimer)\/[^"'`\n]*)["'`]/g;
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*|\{\/\*|<!--)/;
const CODE_FILE = /\.(astro|ts|tsx|js|mjs)$/;
for (const file of walkText(join(ROOT, 'src'))) {
  if (!CODE_FILE.test(file)) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  const text = lines.map((l) => (COMMENT_LINE.test(l) ? '' : l)).join('\n');
  for (const m of text.matchAll(CODE_LINK)) {
    const href = m[1];
    if (href.includes('${')) continue;
    const norm = href.endsWith('/') ? href : href + '/';
    if (!known.has(norm)) problems.push(`${posix.relative(ROOT, file)}: 존재하지 않는 내부 링크 ${href}`);
  }
}

/**
 * 7) 코드 안에 있는 게시 데이터도 같은 honesty 규칙을 따라야 합니다.
 *    문서(md)만 검사하면 일정표(schedule.ts)의 기한·금액 칸이 무방비로 통과합니다.
 *    pending 항목은 시점(dueText)을 채울 수 없고, 라벨·설명에 검증 안 된 수치도 못 씁니다.
 */
const SCHEDULE = readFileSync(join(ROOT, 'src', 'data', 'schedule.ts'), 'utf8');
// 링크는 const 로 묶어 재사용하므로 상수를 먼저 풀어 읽습니다.
const SOURCE_CONSTS = new Map();
for (const m of SCHEDULE.matchAll(/const ([A-Z_]+): ScheduleSource = \{([^}]*)\}/g)) {
  const label = /label:\s*'([^']*)'/.exec(m[2])?.[1] ?? '';
  const url = /url:\s*'([^']*)'/.exec(m[2])?.[1] ?? '';
  SOURCE_CONSTS.set(m[1], { label, url });
}
const ITEM_BLOCKS = SCHEDULE.match(/\n  \{\n[\s\S]*?\n  \}/g) ?? [];
if (ITEM_BLOCKS.length === 0) problems.push('src/data/schedule.ts: 항목을 찾지 못했습니다(검사 규칙과 데이터 형식이 어긋남)');
const SELF_HOST = 'proxsolver.github.io';
for (const block of ITEM_BLOCKS) {
  const id = /id:\s*'([^']+)'/.exec(block)?.[1] ?? '(알 수 없음)';
  const verified = /verification:\s*'verified'/.test(block);
  const due = /dueText:\s*(null|'([^']*)')/.exec(block);
  if (!due) problems.push(`schedule.ts ${id}: dueText 칸이 없습니다(null 을 적어도 기입하세요)`);
  // 필드를 아예 빼먹으면 pending 으로 해석되어 아래 검사에 걸리지만, 왜 막혔는지 메시지가 애매하므로 먼저 잡습니다.
  if (!/verification:\s*'(verified|pending)'/.test(block)) {
    problems.push(`schedule.ts ${id}: verification 칸이 없습니다 — 값을 확인해 'verified' 또는 'pending' 으로 명시하세요`);
  }
  if (!verified) {
    if (due && due[1] !== 'null') problems.push(`schedule.ts ${id}: 검증 대기 항목의 시점이 채워져 있습니다 → ${due[2]}`);
    for (const { re, why } of FORBIDDEN_WHILE_PENDING) {
      const m = re.exec(block);
      if (m) problems.push(`schedule.ts ${id}: 검증 대기 항목에 ${why}("…${m[0]}…") 가 있습니다`);
    }
  }
  const refs = (/\n\s+sources:\s*\[([^\]]*)\]/.exec(block)?.[1] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const urls = [];
  for (const ref of refs) {
    const hit = SOURCE_CONSTS.get(ref);
    if (!hit) {
      problems.push(`schedule.ts ${id}: sources 의 '${ref}' 가 파일 안에 없습니다(상수 이름 확인)`);
      continue;
    }
    urls.push(hit.url);
    if (!hit.label) problems.push(`schedule.ts ${id}: 확인 창구 '${ref}' 에 표시할 이름이 없습니다`);
  }
  if (urls.length === 0) problems.push(`schedule.ts ${id}: 확인 창구 링크(sources)가 없습니다`);
  for (const u of urls) {
    let host = '';
    try {
      host = new URL(u).hostname;
    } catch {
      problems.push(`schedule.ts ${id}: 링크 형식 오류 → ${u}`);
      continue;
    }
    if (host !== SELF_HOST && !/(^|\.)(go\.kr|or\.kr|gov\.kr)$/i.test(host)) {
      problems.push(`schedule.ts ${id}: 공공 기관 영역이 아닌 링크 → ${host}`);
    }
  }
  if (!/decidedBy:\s*'[^']+/.test(block)) problems.push(`schedule.ts ${id}: 값이 어디서 확정되는지(decidedBy)가 비어 있습니다`);
  if (verified) {
    // pending → verified 로 바꾸면 수치 금지가 풀립니다. 채워진 시점은 그 자리에서 재확인 가능한
    // 법령·국세청 링크와 조문 인용을 같은 항목에서 요구합니다.
    const hosts = urls.map((u) => {
      try {
        return new URL(u).hostname;
      } catch {
        return '';
      }
    });
    const dueHasFigure = /dueText:\s*'[^']*\d/.test(block);
    const citesLaw = /제\s?\d+조/.test(block);
    const selfOnly = refs.length > 0 && refs.every((r) => (SOURCE_CONSTS.get(r)?.url ?? '').includes(SELF_HOST));
    if (dueHasFigure && !hosts.some((h) => RECHECK_HOSTS.test(h)))
      problems.push(`schedule.ts ${id}: 검증 완료 시점(${due && due[2] ? due[2] : ''})에 수치가 있는데 확인 창구에 법령·국세청·홈택스 링크가 없습니다 — 확인한 원문 링크를 sources 에 넣으세요`);
    if (citesLaw && !hosts.some((h) => /(^|\.)law\.go\.kr$/i.test(h)))
      problems.push(`schedule.ts ${id}: 조문(제N조)을 적으면서 그 항목의 확인 창구에 국가법령정보센터 링크가 없습니다`);
    if (selfOnly && !/자체|권장/.test(block))
      problems.push(`schedule.ts ${id}: 이 사이트 링크만 걸어 두고 자체 권장임을 적지 않았습니다 — 기관 요구로 읽힐 수 있습니다`);
  }
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
/**
 * @param {string} dir
 * @returns {Generator<string>}
 */
function* walkText(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.astro') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walkText(p);
    else if (/\.(astro|ts|js|mjs|md|yml|yaml|css|json|svg)$/.test(name)) yield p;
  }
}
/** @type {string[]} */
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
