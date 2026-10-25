/**
 * DOCX 로 내보내기 — ZIP 을 손으로 짜는 코드입니다.
 *
 * 왜 손으로 짜는가: 이 사이트는 npm 패키지를 하나도 넣지 않고 서는 정적 페이지이고, 그 약속을
 * 보고서 DOCX 라고 깨지 않습니다. Word 가 여는 최소 구성은 세 조각뿐입니다 —
 * `[Content_Types].xml`, `_rels/.rels`, `word/document.xml`. 전부 문자열로 쓰고, OPC 규격이 요구하는
 * deflate 로만 압축합니다(zip 은 STORE 도 허용하지만, Word 가 STORE 항목을 받아들인다는 근거를 찾지 못해
 * 쓰지 않습니다). CRC-32·크기·시각은 local 헤더와 central 항목이 반드시 같아야 하므로, 압축 결과를 먼저
 * 버퍼에 받아 크기와 검사값을 안 뒤에 헤더를 씁니다.
 *
 * 한글은 글꼴 이름이 두 개입니다. Word 는 한글 글자(AC00–D7AF 등)를 **eastAsia 글꼴**로 그리고, 지정이
 * 없으면 Times New Roman 으로 그려 깨져 보입니다. 그래서 모든 run 에 eastAsia 를 실습니다(영문 이름은
 * 영문 Word 에서, 한글 이름은 국문 Word 에서 같은 글꼴로 풀립니다). styles.xml 을 안 넣는 대신 크기·색을
 * run 마다 적습니다 — 기본 스타일이 한글을 못 그리는 상황을 피하는 가장 값싼 방법입니다.
 *
 * 지킨 것: HTML 과 **같은 `Report` 모델**을 나눠 쓰므로 두 파일의 숫자·행 수가 갈라질 수 없습니다.
 * 모르는 값은 그대로 〔채우기〕, 외부 자산·스크립트 없음, 사용자 값은 XML 이스케이프 뒤에 들어갑니다.
 */
import type { Report, ReportTable } from './report';

/** A4 세로(16mm 여백) — 표 열 폭을 이 본문 폭에 맞춥니다. HTML 의 @page 와 같은 값입니다. */
const PAGE_W = 11906;
const PAGE_H = 16838;
const MARGIN = 907;
const CONTENT_W = PAGE_W - MARGIN * 2;

const INK = '14181F';
const MUTED = '59616E';
const RULE = 'D9DEE6';
const HEAD_FILL = 'EEF1F5';
const WARN = 'A5670A';
const NOTE_FILL = 'FFF8E8';
const NOTE_RULE = 'D6B26A';

/**
 * 모든 run 에 같은 글꼴 지정을 박습니다 — styles.xml 을 안 넣으므로 이게 유일한 지정입니다.
 * 동아시아(`eastAsia`)가 한글을 그리는 칸이고, 영문 이름은 영문 Word 에서 한글 이름은 국문 Word 에서
 * 같은 글꼴로 풀립니다. 복합글씨 지정(cs·bCs·iCs·szCs) 은 빼는데, 한국어 문서에서 쓰이는 일이 없고
 * 행마다 형식 지정을 두 번 담지 않아도 되어 파일이 절반으로 줄어듭니다.
 */
const FONT = '<w:rFonts w:ascii="Malgun Gothic" w:eastAsia="맑은 고딕" w:hAnsi="Malgun Gothic"/>';

/** report.ts 의 자리표시자와 같은 글자여야 합니다(화면이 요청하는 칸과 문서의 주의색 칸이 어긋나지 않게). */
const BLANK = '〔채우기〕';

/** DOCX 조립에 필요한 브라우저 능력. 없으면 HTML 로 안내합니다 — 만들지 못하는 파일을 만든 척하지 않습니다. */
export function docxSupport(): { ok: boolean; why: string } {
  const g = globalThis as Record<string, unknown>;
  if (typeof g.CompressionStream !== 'function')
    return {
      ok: false,
      why: '이 브라우저는 압축 API(CompressionStream)가 없어 DOCX 를 만들 수 없습니다. 보고서 HTML 을 내려받아 인쇄 → PDF로 저장 을 써 주세요.'
    };
  if (typeof g.Response !== 'function' || typeof g.TextEncoder !== 'function')
    return {
      ok: false,
      why: '이 브라우저는 DOCX 조립에 필요한 Web API 일부를 제공하지 않습니다. 보고서 HTML 을 내려받아 인쇄 → PDF로 저장 을 써 주세요.'
    };
  return { ok: true, why: '' };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

/** zip 이 요구하는 CRC-32 (다항식 EDB88320, 초깃값 FFFFFFFF). Node 의 zlib 을 안 쓰는 이유: 브라우저에서 돌아야 합니다. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[], totalLength: number): Uint8Array {
  const out = new Uint8Array(totalLength);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** deflate-raw 압축(zip method 8). xlsx 를 읽을 때 쓰는 것과 같은 Web 스트림 방향의 반대입니다. */
async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer]);
  const stream = blob.stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * zip 은 MS-DOS 시각만 씁니다. 연도 칸이 7 비트(0~127)라 1980 ~ 2107 을 넘는 시각은 비트가 넘칩니다.
 * 아래쪽은 연도 비트만 1980 으로 고치면 달·일이 남아 1969-12-31 이 1980-12-31 이 되는 문제가 있어(실측)
 * 아예 1980-01-01 00:00:00 으로 내리고, 위쪽은 2107 년의 같은 달·일로 붙입니다 — 헤더가 깨지는 것보다 낫습니다.
 */
function dosStamp(d: Date): { time: number; date: number } {
  if (d.getFullYear() < 1980) return { time: 0, date: (0 << 9) | (1 << 5) | 1 };
  const year = Math.min(2107, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  };
}

interface ZipPart {
  name: string;
  data: Uint8Array;
}

/** 여러 조각을 deflate zip 으로 싸웁니다. local·central 의 CRC·크기·시각·오프셋을 똑같이 복제합니다. */
async function buildZip(parts: ZipPart[], now: Date): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const { time, date } = dosStamp(now);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  let centralSize = 0;

  for (const part of parts) {
    const name = enc.encode(part.name);
    const compressed = await deflateRaw(part.data);
    const crc = crc32(part.data);

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // 필요 버전 2.0 — deflate
    lv.setUint16(6, 0x0800, true); // flag bit 11: 파일이름·내용 UTF-8
    lv.setUint16(8, 8, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, compressed.length, true);
    lv.setUint32(22, part.data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true); // extra 길이 0
    local.set(name, 30);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // 만든 쪽: DOS 2.0
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 8, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, compressed.length, true);
    cv.setUint32(24, part.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true); // extra
    cv.setUint16(32, 0, true); // comment
    cv.setUint16(34, 0, true); // 시작 디스크
    cv.setUint16(36, 0, true); // 내부 속성
    cv.setUint32(38, 0, true); // 외부 속성
    cv.setUint32(42, offset, true);
    central.set(name, 46);

    locals.push(local, compressed);
    centrals.push(central);
    offset += local.length + compressed.length;
    centralSize += central.length;
  }

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, parts.length, true);
  ev.setUint16(10, parts.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  return concat([...locals, ...centrals, eocd], offset + centralSize + 22);
}

/* ---------------------------------------------------------------- XML 조각 */

/** XML 1.0 이 금지하는 제어문자(탭·CR·LF 제외)를 지웁니다. 사용자 붙여넣기에서도 들어올 수 있습니다. */
function scrub(s: string): string {
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

function xml(s: string): string {
  return scrub(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

interface RunStyle {
  bold?: boolean;
  size?: number;
  color?: string;
  italic?: boolean;
}

/** run 의 형식 조각. 본문 9pt 가 기본(크기는 half-point 라 값 18 = 9pt). */
function runProps(style: RunStyle): string {
  const size = style.size ?? 18;
  return [FONT, style.bold ? '<w:b/>' : '', style.italic ? '<w:i/>' : '', `<w:color w:val="${style.color ?? INK}"/>`, `<w:sz w:val="${size}"/>`].join('');
}

/**
 * `w:t` 는 한 줄 값만 담습니다. 붙여넣기로 들어온 행 안의 개행·탭을 그대로 실으면
 * `xml:space="preserve"` 가 그 줄바꿈까지 보존해 셀 안에서 형태가 어긋납니다(HTML 은 기본 공백 압축이라 안전합니다).
 * 여러 줄 특이사항은 본문에서 문단으로 쪼갠 뒤에 이 함수를 지나므로, 여기 남는 개행은 찌꺼기입니다.
 */
function flat(s: string): string {
  return s.replace(/[\r\n\t ]+/g, ' ');
}

function run(text: string, style: RunStyle = {}): string {
  return `<w:r><w:rPr>${runProps(style)}</w:rPr><w:t xml:space="preserve">${xml(flat(text))}</w:t></w:r>`;
}

interface ParaStyle extends RunStyle {
  align?: 'left' | 'center' | 'right';
  before?: number;
  after?: number;
  fill?: string;
  /** 사방 테두리 색. 없으면 테두리를 안 씁니다. */
  rule?: string;
}

/**
 * 문단. `w:pPr` 자식 순서는 규격이 정한 순서(pBdr → shd → spacing → jc → rPr)대로 —
 * 순서가 어긋나면 Word 가 파일을 '손상됨' 으로 처리합니다.
 * 문단표시의 `rPr` 을 run 과 같은 글꼴·크기로 반드시 실습니다: Word 는 **행 높이를 문단표시 글꼴로** 계산합니다.
 * 이게 없으면 표 안의 작은 글씨(7.5pt) 셀도 판독기 기본 크기에 맞춰 행이 부풀고,
 * 여백으로 넣은 빈 문단(`para('')`)까지 그대로 기본 크기에서 쌓입니다(파일이 조금 더 커지는 것은 감수합니다).
 */
function para(text: string, style: ParaStyle = {}): string {
  const pPr: string[] = [];
  if (style.rule) {
    const sides = ['top', 'left', 'bottom', 'right']
      .map((side) => `<w:${side} w:val="single" w:sz="6" w:space="2" w:color="${style.rule}"/>`)
      .join('');
    pPr.push(`<w:pBdr>${sides}</w:pBdr>`);
  }
  if (style.fill) pPr.push(`<w:shd w:val="clear" w:color="auto" w:fill="${style.fill}"/>`);
  pPr.push(`<w:spacing w:before="${style.before ?? 0}" w:after="${style.after ?? 80}" w:line="240" w:lineRule="auto"/>`);
  if (style.align) pPr.push(`<w:jc w:val="${style.align}"/>`);
  const markSize = style.size ?? 18;
  pPr.push(`<w:rPr>${FONT}<w:color w:val="${style.color ?? INK}"/><w:sz w:val="${markSize}"/></w:rPr>`);
  return `<w:p><w:pPr>${pPr.join('')}</w:pPr>${run(text, style)}</w:p>`;
}

function heading(text: string): string {
  return para(text, { bold: true, size: 21, before: 220, after: 80 });
}

/** 표 안 문단은 아래 여백을 0 으로 — 행 높이가 부풀어 표가 페이지를 넘기지 않습니다. */
function cellPara(text: string, align: 'left' | 'right', style: RunStyle): string {
  return para(text, { ...style, align, after: 0 });
}

/** 한글·전각문자는 폭 2, 나머지는 1 로 세워 열 폭을 가늠합니다. */
function displayLen(s: string): number {
  let n = 0;
  for (const ch of s) n += ch.charCodeAt(0) > 0x2e80 ? 2 : 1;
  return n;
}

/**
 * 열 폭 = 머리 글자 수와 본문에서 가장 긴 값(상한 26)에 비례해 본문 폭 10092 를 쪼갭니다.
 * 반올림 오차는 마지막 열에서 고치되, 그 열이 700 twip 아래로 떨어지면 가장 넓은 열에서 빼 옵니다 —
 * 합이 본문 폭을 넘으면 표가 페이지 밖으로 나갑니다.
 */
function columnWidths(t: ReportTable, total: number): number[] {
  const weights = t.head.map((h, i) => {
    let longest = displayLen(h);
    for (const row of t.rows) longest = Math.max(longest, Math.min(displayLen(row[i] ?? ''), 26));
    return Math.max(longest, 6);
  });
  const sum = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => Math.max(620, Math.round((total * w) / sum)));
  let diff = total - widths.reduce((a, b) => a + b, 0);
  const last = widths.length - 1;
  if (widths[last] + diff < 700) {
    let widest = 0;
    for (let i = 0; i < widths.length; i++) if (widths[i] > widths[widest]) widest = i;
    widths[widest] -= 700 - (widths[last] + diff);
    diff = total - widths.reduce((a, b) => a + b, 0);
  }
  widths[last] += diff;
  return widths;
}

const BORDER_SIDES = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
  .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="${RULE}"/>`)
  .join('');

interface CellSpec {
  text: string;
  /** 열 번호가 아니라 셀 자체로 형식을 정합니다 — 머리 표의 〔채우기〕 처럼 값마다 달라지는 칸 때문입니다. */
  right?: boolean;
  warn?: boolean;
}

function rowCells(cells: CellSpec[], widths: number[], header: boolean): string {
  const trPr = '<w:trPr><w:cantSplit/>' + (header ? '<w:tblHeader w:val="true"/>' : '') + '</w:trPr>';
  // 열 폭은 머리 기준으로 계산됩니다. 행이 머리보다 많은 칸을 들고 오면(호출 측 실수) 그 칸에 줄 폭이 없어
  // `w:w="undefined"` 라는 규격에 맞지 않는 속성이 나옵니다 — 마지막 폭을 재사용해 표 전체가 헛나가지 않게 합니다.
  const lastWidth = widths.length > 0 ? widths[widths.length - 1] : 0;
  const body = cells
    .map((c, i) => {
      const tcPr = [`<w:tcW w:w="${widths[i] ?? lastWidth}" w:type="dxa"/>`, header ? `<w:shd w:val="clear" w:color="auto" w:fill="${HEAD_FILL}"/>` : '', '<w:vAlign w:val="top"/>'].join('');
      const style: RunStyle = { bold: header, size: 15, color: c.warn ? WARN : undefined };
      return `<w:tc><w:tcPr>${tcPr}</w:tcPr>${cellPara(c.text, c.right ? 'right' : 'left', style)}</w:tc>`;
    })
    .join('');
  return `<w:tr>${trPr}${body}</w:tr>`;
}

/**
 * 표. `w:tblPr` 자식 순서(tblW → tblBorders → tblLayout → tblCellMar → tblLook)를 지킵니다.
 * 정렬·주의색은 셀마다 붙이므로 열 번호를 받지 않습니다(머리 표의 〔채우기〕 처럼 값마다 형식이 달라집니다).
 * 행이 없으면 호출하지 않습니다 — 빈 표는 Word 에서도 어색해서 문장으로 대신합니다.
 */
function table(head: string[], rows: CellSpec[][], widths: number[]): string {
  const tblPr = [
    `<w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/>`,
    `<w:tblBorders>${BORDER_SIDES}</w:tblBorders>`,
    '<w:tblLayout w:type="fixed"/>',
    '<w:tblCellMar><w:top w:w="20" w:type="dxa"/><w:left w:w="60" w:type="dxa"/><w:bottom w:w="20" w:type="dxa"/><w:right w:w="60" w:type="dxa"/></w:tblCellMar>',
    '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>'
  ].join('');
  const grid = `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;
  const headRow = rowCells(head.map((h) => ({ text: h })), widths, true);
  const body = rows.map((r) => rowCells(r, widths, false)).join('');
  return `<w:tbl>${tblPr}${grid}${headRow}${body}</w:tbl>`;
}

function twoColumnTable(rows: { label: string; value: string; warn?: boolean }[]): string {
  return table(
    ['구분', '값'],
    rows.map((r) => [{ text: r.label }, { text: r.value, warn: r.warn }]),
    [4800, CONTENT_W - 4800]
  );
}

/* ------------------------------------------------------------------ 본문 */

/**
 * 보고서 모델 → WordProcessingML 본문 문자열. 파일로 싸는 일은 `buildDocx` 가 합니다.
 * 순서·값은 HTML 과 똑같은 `Report` 에서 나오므로, 두 파일이 서로 다른 숫자를 담을 수 없습니다.
 * 〔채우기〕 는 주의색으로 칠해 어디를 손으로 채워야 하는지 Word 에서도 보이게 합니다.
 */
export function reportToDocxBody(r: Report): string {
  const parts: string[] = [];

  parts.push(para(r.title, { bold: true, size: 30, after: 40 }));
  parts.push(para(`정산 기간 ${r.period} · 작성 ${r.generatedAt}`, { color: MUTED, size: 17, after: 120 }));
  parts.push(para(r.unofficial, { bold: true, size: 17, fill: NOTE_FILL, rule: NOTE_RULE, after: 220 }));

  parts.push(heading('보고서 머리'));
  parts.push(
    twoColumnTable(
      r.metaRows.map((m) => ({ label: m.label, value: m.value, warn: m.value === BLANK }))
    )
  );
  parts.push(para('', { size: 12, after: 40 }));

  parts.push(heading('요약'));
  parts.push(twoColumnTable(r.summaryRows.map((s) => ({ label: s.label, value: s.value }))));
  parts.push(para('', { size: 12, after: 40 }));

  for (const t of r.tables) {
    parts.push(heading(`${t.title} (${t.rows.length}행)`));
    if (t.rows.length === 0) {
      parts.push(para(t.emptyNote, { color: MUTED, italic: true, size: 17, after: 120 }));
      continue;
    }
    const rows = t.rows.map((row) => row.map((cell, i) => ({ text: cell, right: i === t.numColumn })));
    parts.push(table(t.head, rows, columnWidths(t, CONTENT_W)));
    parts.push(para('', { size: 12, after: 40 }));
  }

  if (r.note) {
    parts.push(heading('특이사항'));
    for (const line of r.note.split(/[\r\n]+/)) parts.push(para(line, { size: 17, after: 60 }));
  }

  parts.push(para(r.sourceLine, { size: 16, fill: HEAD_FILL, rule: RULE, before: 200, after: 80 }));
  parts.push(para(r.footer, { color: WARN, bold: true, size: 16, after: 40 }));
  parts.push(
    para(
      '이 DOCX 는 이 브라우저 안에서 조립한 파일입니다(서버로 보내는 것 없음). 한글이 깨져 보이면 서식의 글꼴을 맑은 고딕 또는 이 컴퓨터에 설치된 한글 글꼴로 바꿔 주세요. 한글(HWP) 프로그램에서 열면 표 모양이 어긋날 수 있으니, 그럴 때는 워드프로세서에서 다른 이름으로 저장을 다시 해 보거나 HTML 보고서를 사용해 주세요.',
      { color: MUTED, size: 15, after: 120 }
    )
  );

  const sectPr = `<w:sectPr><w:pgSz w:w="${PAGE_W}" w:h="${PAGE_H}"/><w:pgMar w:top="${MARGIN}" w:right="${MARGIN}" w:bottom="${MARGIN}" w:left="${MARGIN}" w:header="567" w:footer="567" w:gutter="0"/><w:docGrid w:linePitch="360"/></w:sectPr>`;
  return `${parts.join('')}${sectPr}`;
}

/** 전체 문서 XML. `w:document` 하나만 있으면 Word 가 본문으로 인정합니다. */
export function reportToDocxXml(r: Report): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${reportToDocxBody(r)}</w:body></w:document>`
  );
}

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '</Types>';

const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '</Relationships>';

/**
 * 보고서 → .docx 바이트. 환경을 검사하고, 만들 수 없으면 사유를 사용자 문장으로 던집니다(화면이 그대로 보여줍니다).
 * `now` 는 zip 시각에 쓰는 값 — 테스트에서는 고정된 날짜를 넣습니다.
 */
export async function buildDocx(r: Report, now: Date = new Date()): Promise<Uint8Array> {
  const support = docxSupport();
  if (!support.ok) throw new Error(support.why);
  const enc = new TextEncoder();
  return buildZip(
    [
      { name: '[Content_Types].xml', data: enc.encode(CONTENT_TYPES) },
      { name: '_rels/.rels', data: enc.encode(ROOT_RELS) },
      { name: 'word/document.xml', data: enc.encode(reportToDocxXml(r)) }
    ],
    now
  );
}
