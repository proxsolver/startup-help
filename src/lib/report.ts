/**
 * 보고서(정리 문서) 만들기 — 명세서를 넣은 뒤에 남는 마지막 한 걸음입니다.
 *
 * 화면의 표와 CSV 는 '재료'이고, 이 파일의 결과물은 기관·회계·본인이 읽을 수 있는 **문서**입니다.
 * 같은 모델(`Report`)을 HTML·DOCX 두 renderer 가 나눠 쓰므로, 두 파일의 숫자와 행이 갈라질 수 없습니다.
 *
 * 지킨 것 세 가지:
 * - **추측해서 채우지 않는다**: 사업명·신청인·기관·기간처럼 알 수 없는 값은 〔채우기〕 자리표시로 남깁니다.
 *   자리표시는 보고서 안에서도, `reportGaps()` 가 화면에 요청하는 항목 안에서도 같은 목록에서 나옵니다.
 * - **비공식 표기를 맨 위와 맨 아래에**: 사이트의 다른 산출물(꾸러미·CSV)과 같은 고지입니다.
 * - **스크립트 없는 HTML**: 내려받은 파일에 `<script>` 를 넣지 않습니다. 파일을 어디서 열어도 동작은 텍스트와 인쇄뿐입니다.
 */
import { computeTotals, currentPeriod, evidenceGapList, formatKRW } from './receipts';
import type { ReceiptEntry } from './receipts';

/**
 * 보고서 머리에 들어가는 사용자 입력. 저장을 막는 필수 검사는 없습니다(비고도 내보낼 수 있습니다).
 * 비면 `REPORT_FIELDS` 의 `required` 에 따라 필수 칸은 〔채우기〕, 선택 칸은 `미기재` 로 나갑니다 —
 * 화면의 「이것만 채워 주세요」 목록과 문서의 자리표시가 같은 출처입니다.
 */
export interface ReportMeta {
  projectName: string;
  applicant: string;
  agency: string;
  periodFrom: string;
  periodTo: string;
  contact: string;
  note: string;
}

/**
 * 문서에 들어가는 값의 길이 상한. 화면 입력창의 `maxlength` 도 이 두 값을 그대로 씁니다 —
 * 입력창이 문서보다 많은 글자를 허용하면 잘린 부분의 의미가 사라집니다(그래서 특이사항만 상한이 큽니다).
 */
export const MAX_REPORT_FIELD_CHARS = 120;
export const MAX_REPORT_NOTE_CHARS = 1000;

/**
 * 화면 입력·저장 로직·보고서가 **같은 목록**을 쓰도록 라벨을 한 곳에 둡니다.
 * 여기서 빠진 항목은 `reportGaps()` 에도, 보고서의 〔채우기〕 칸에도 나타나지 않습니다(세 곳 어긋남 방지).
 */
export const REPORT_FIELDS: { key: keyof ReportMeta; label: string; hint: string; required: boolean }[] = [
  { key: 'projectName', label: '사업명', hint: '공고에 적힌 사업명 그대로', required: true },
  { key: 'applicant', label: '신청인·대표자', hint: '정산 서류에 적는 이름', required: true },
  { key: 'agency', label: '주관 기관', hint: '예: 신한은행 모두의 창업', required: true },
  { key: 'periodFrom', label: '정산 기간 시작', hint: 'YYYY-MM-DD', required: true },
  { key: 'periodTo', label: '정산 기간 종료', hint: 'YYYY-MM-DD', required: true },
  { key: 'contact', label: '연락처', hint: '담당자 전화·이메일 (선택)', required: false },
  { key: 'note', label: '특이사항', hint: '기관에 미리 알릴 일이 있으면 한두 줄 (선택)', required: false }
];

export function emptyReportMeta(): ReportMeta {
  return { projectName: '', applicant: '', agency: '', periodFrom: '', periodTo: '', contact: '', note: '' };
}

const text = (v: unknown, cap = MAX_REPORT_FIELD_CHARS): string =>
  typeof v === 'string' ? v.trim().replace(/[\r\n]+/g, ' ').slice(0, cap) : '';

/**
 * 특이사항만 줄을 살립니다. 한 줄로 눌러 버리면 HTML 의 `white-space: pre-wrap` 도,
 * DOCX 가 개행째 문단으로 나누는 코드도 죽은 경로가 됩니다(죽은 코드는 검사가 못 잡습니다).
 * 줄바꿈 자체는 살리되 연속 공백·줄은 하나로 정리해 들어갑니다.
 */
const multiline = (v: unknown, cap: number): string =>
  typeof v === 'string'
    ? v
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t\u00a0]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, cap)
    : '';

/** 저장본·백업·화면 입력을 안전한 형태로 줄여 둡니다(형식이 아무것도 없으면 빈 설정). */
export function normalizeReportMeta(raw: unknown): ReportMeta {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const date = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : '');
  return {
    projectName: text(o.projectName),
    applicant: text(o.applicant),
    agency: text(o.agency),
    periodFrom: date(o.periodFrom),
    periodTo: date(o.periodTo),
    contact: text(o.contact),
    note: multiline(o.note, MAX_REPORT_NOTE_CHARS)
  };
}

/** 필수 칸 중 아직 비어 있는 것 — 화면의 「이것만 채워 주세요」와 보고서의 자리표시가 같은 출처입니다. */
export function reportGaps(meta: ReportMeta): { key: keyof ReportMeta; label: string; hint: string }[] {
  return REPORT_FIELDS.filter((f) => f.required && !meta[f.key]).map((f) => ({ key: f.key, label: f.label, hint: f.hint }));
}

const BLANK = '〔채우기〕';

/**
 * 보고서에 쓸 값. 비어 있으면 자리표시자 — 빈칸으로 두지 않아 채워야 할 곳이 눈에 보입니다.
 * 단, 〔채우기〕는 **필수 칸에만** 붙입니다. 선택 칸까지 〔채우기〕 로 나오면 화면이 「이것만 채워 주세요」 라고
 * 부르는 목록과 문서에 빈칸으로 남은 목록이 어긋나므로(화면은 필수만 요청), 선택 칸은 '미기재' 로 적습니다.
 */
function metaValue(f: { key: keyof ReportMeta; required: boolean }, meta: ReportMeta): string {
  return meta[f.key] || (f.required ? BLANK : '미기재');
}

/** 완성된 보고서가 실제로 품은 〔채우기〕 개수. 화면이 따로 세지 않고 문서의 칸을 셉니다. */
export function reportBlankCount(report: Report): number {
  return report.metaRows.filter((row) => row.value === BLANK).length;
}

export interface ReportTable {
  title: string;
  head: string[];
  rows: string[][];
  /** 오른쪽 정렬할 열 번호(금액). 표마다 위치가 달라 renderer 가 추측하지 않도록 모델에 적어 둡니다. */
  numColumn: number;
  /** 행이 없을 때 표 대신 넣는 문장. '0건' 을 빈 표로 보여주지 않습니다. */
  emptyNote: string;
}

export interface Report {
  title: string;
  /** 비공식 표기 — 파일 어느 곳에서나 한 번이 아니라 머리·각주 두 번 들어갑니다. */
  unofficial: string;
  period: string;
  generatedAt: string;
  metaRows: { label: string; value: string }[];
  summaryRows: { label: string; value: string }[];
  tables: ReportTable[];
  note: string;
  sourceLine: string;
  footer: string;
}

export interface ReportInput {
  entries: ReceiptEntry[];
  meta: ReportMeta;
  /** 보고서에 쓸 정산 기간. 없으면 meta 의 기간, 그것도 없으면 데이터의 최소~최대 달. */
  period?: string;
  generatedAt?: Date;
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function stamp(d: Date): string {
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

/**
 * 보고서 모델. 숫자는 전부 `computeTotals` · `evidenceGapList` 에서 나옵니다 —
 * 화면 요약·CSV·꾸러미와 같은 함수를 쓰므로 파일과 화면이 서로 다른 값을 보여줄 수 없습니다.
 */
export function buildReport(input: ReportInput): Report {
  const entries = Array.isArray(input.entries) ? input.entries : [];
  const meta = normalizeReportMeta(input.meta);
  const now = input.generatedAt ?? new Date();
  const totals = computeTotals(entries);

  const period =
    input.period ||
    (meta.periodFrom && meta.periodTo
      ? `${meta.periodFrom} ~ ${meta.periodTo}`
      : meta.periodFrom || meta.periodTo || currentPeriod(now));

  const tableRows = entries
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((e) => [
      e.date,
      e.vendor || '(거래처 미입력)',
      e.approvalNo || '—',
      formatKRW(e.amount),
      e.budgetItem || '(비목 미정)',
      e.payMethod,
      e.evidenceType,
      e.evidenceState,
      e.submitState
    ]);

  const gaps = evidenceGapList(entries).map((e) => [
    e.date,
    e.vendor || '(거래처 미입력)',
    e.approvalNo || '—',
    formatKRW(e.amount),
    e.evidenceType
  ]);

  const byBudget = totals.byBudgetItem
    .slice()
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((g) => [g.key || '(미입력)', `${g.count}건`, formatKRW(g.total)]);

  return {
    title: '사업비 집행 정리 보고서',
    unofficial: '비공식 — 참여자가 스스로 정리한 자료입니다. 기관 안내 문구·공식 제출 서식을 대체하지 않습니다.',
    period,
    generatedAt: stamp(now),
    metaRows: REPORT_FIELDS.filter((f) => f.key !== 'note').map((f) => ({ label: f.label, value: metaValue(f, meta) })),
    summaryRows: [
      { label: '집행 기록', value: `${totals.count}건` },
      { label: '총 집행액', value: formatKRW(totals.total) },
      { label: '전용(체크)카드 경로', value: `${formatKRW(totals.dedicatedTotal)} (${totals.dedicatedRate}%)` },
      { label: '증빙 공백(미수취·재요청)', value: `${totals.evidenceGapCount}건 · ${formatKRW(totals.evidenceGapTotal)}` },
      { label: '기간 확인 필요·기간 외', value: `${totals.periodRiskCount}건 · ${formatKRW(totals.periodRiskTotal)}` },
      { label: '제출 전', value: `${totals.notSubmittedCount}건 · ${formatKRW(totals.notSubmittedTotal)}` }
    ],
    tables: [
      {
        title: '1. 집행 목록',
        head: ['지출일', '거래처', '승인번호', '금액', '비목', '결제경로', '증빙 종류', '수취', '제출'],
        rows: tableRows,
        numColumn: 3,
        emptyNote: '집행 기록이 없습니다. 명세서 파일을 넣거나 새 지출을 추가한 뒤 다시 만드세요.'
      },
      {
        title: '2. 비목별 합계',
        head: ['비목', '건수', '금액'],
        rows: byBudget,
        numColumn: 2,
        emptyNote: '비목이 정해진 행이 없습니다.'
      },
      {
        title: '3. 증빙이 아직 없는 건',
        head: ['지출일', '거래처', '승인번호', '금액', '증빙 종류'],
        rows: gaps,
        numColumn: 3,
        emptyNote: '미수취·재요청으로 잡히는 건이 없습니다.'
      }
    ],
    note: meta.note || '',
    sourceLine: '이 파일의 숫자는 전부 사용자 입력(이 브라우저에 저장된 집행 기록)에서 나온 값입니다. 사이트가 임의로 만든 수치가 아닙니다.',
    footer: '비공식 정리 자료 — 제출 전 담당 기관의 공식 서식과 기준을 다시 확인하세요.'
  };
}

/** HTML·DOCX 둘 다 사용자 값을 마크업에 넣기 전에 이스케이프합니다. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STYLE = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; color: #14181f; background: #fff;
    font: 14px/1.6 "Apple SD Gothic Neo", "Malgun Gothic", "맑은 고딕", system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 900px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: -0.01em; }
  h2 { font-size: 15px; margin: 26px 0 8px; padding-bottom: 4px; border-bottom: 2px solid #14181f; }
  .unofficial { margin: 0 0 18px; padding: 10px 12px; border: 1px solid #d6b26a; border-left-width: 4px;
    background: #fff8e8; color: #5a4413; font-size: 13px; }
  .meta { display: grid; grid-template-columns: 140px 1fr; gap: 4px 12px; margin: 0 0 6px; font-size: 13px; }
  .meta dt { color: #59616e; }
  .meta dd { margin: 0; font-weight: 600; }
  .blank { color: #a5670a; }
  .summary { width: 100%; border-collapse: collapse; margin: 8px 0 4px; font-size: 13px; }
  .summary th { text-align: left; font-weight: 600; padding: 6px 8px; background: #f2f4f7; border: 1px solid #d9dee6; }
  .summary td { padding: 6px 8px; border: 1px solid #d9dee6; }
  .scroll { overflow-x: auto; }
  table.data { width: 100%; border-collapse: collapse; font-size: 12px; }
  table.data th, table.data td { border: 1px solid #d9dee6; padding: 5px 7px; text-align: left; vertical-align: top; }
  table.data thead th { background: #eef1f5; white-space: nowrap; }
  table.data td.num { text-align: right; white-space: nowrap; }
  .empty { margin: 6px 0; padding: 10px 12px; border: 1px dashed #c7ccd4; color: #59616e; font-size: 13px; }
  .note { white-space: pre-wrap; }
  footer { margin-top: 28px; padding-top: 10px; border-top: 1px solid #d9dee6; color: #59616e; font-size: 12px; }
  @page { size: A4; margin: 16mm; }
  @media print {
    body { padding: 0; font-size: 11px; }
    main { max-width: none; }
    .scroll { overflow: visible; }
    h2 { page-break-after: avoid; }
    table.data { font-size: 9.5px; }
    tr { page-break-inside: avoid; }
    a { color: inherit; text-decoration: none; }
  }
`;

/** 스크립트·외부 자산이 없는 단일 HTML 파일. 브라우저에서 열어 바로 인쇄(PDF)할 수 있습니다. */
export function reportToHtml(r: Report): string {
  const head = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="비공식 사업비 집행 정리 보고서 — 사용자 입력 데이터로 만든 자체 정리 자료">
<title>${escapeHtml(r.title)} · ${escapeHtml(r.period)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>${escapeHtml(r.title)}</h1>
<p class="unofficial"><strong>${escapeHtml(r.unofficial)}</strong></p>
<dl class="meta">`;

  const metaRows = r.metaRows
    .map((m) => {
      const blank = m.value === BLANK ? ' class="blank"' : '';
      return `<dt>${escapeHtml(m.label)}</dt><dd${blank}>${escapeHtml(m.value)}</dd>`;
    })
    .join('\n');

  const periodLine = `<dt>정산 기간</dt><dd>${escapeHtml(r.period)}</dd>\n<dt>작성 시각</dt><dd>${escapeHtml(r.generatedAt)}</dd>`;

  const summary = `\n</dl>
<h2>요약</h2>
<table class="summary">
<tbody>
${r.summaryRows.map((s) => `<tr><th scope="row">${escapeHtml(s.label)}</th><td>${escapeHtml(s.value)}</td></tr>`).join('\n')}
</tbody>
</table>`;

  const tables = r.tables
    .map((t) => {
      const thead = `<thead><tr>${t.head.map((h) => `<th scope="col">${escapeHtml(h)}</th>`).join('')}</tr></thead>`;
      if (t.rows.length === 0) return `\n<h2>${escapeHtml(t.title)}</h2>\n<p class="empty">${escapeHtml(t.emptyNote)}</p>`;
      const tbody = `<tbody>\n${t.rows
        .map(
          (row) =>
            `<tr>${row
              .map((c, i) => (i === t.numColumn ? `<td class="num">${escapeHtml(c)}</td>` : `<td>${escapeHtml(c)}</td>`))
              .join('')}</tr>`
        )
        .join('\n')}
</tbody>`;
      return `\n<h2>${escapeHtml(t.title)} <span>(${t.rows.length}행)</span></h2>\n<div class="scroll"><table class="data">${thead}\n${tbody}</table></div>`;
    })
    .join('\n');

  const note = r.note
    ? `\n<h2>특이사항</h2>\n<p class="note">${escapeHtml(r.note)}</p>`
    : '';

  const foot = `\n<footer>
<p>${escapeHtml(r.sourceLine)}</p>
<p>${escapeHtml(r.footer)}</p>
<p>A4 인쇄·「PDF로 저장」에 맞춘 파일입니다. 이 문서에는 스크립트가 없습니다.</p>
</footer>
</main>
</body>
</html>
`;

  return `${head}${metaRows}\n${periodLine}${summary}\n${tables}${note}${foot}`;
}

/**
 * 파일 이름은 `report_<기간>_<YYYYMMDD>` (확장은 renderer 가 붙입니다).
 * 기간에 한글·공백·물결표가 들어 있어도 파일 시스템이 죽지 않도록, 구분 물결표는 그냥 붙이고 나머지는 `_` 로 줄여웁니다.
 */
export function reportFileName(period: string, now: Date = new Date()): string {
  const safe = (period || '')
    .replace(/\s*~\s*/g, '-')
    .replace(/[^0-9A-Za-z._-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[_.-]+|[_.-]+$/g, '')
    .slice(0, 40);
  const dateStamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  return `report_${safe || 'all'}_${dateStamp}`;
}
