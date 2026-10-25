/**
 * 정산 꾸러미 내보내기 — 이 사이트의 "미끼" 에 해당하는 실체 산출물입니다.
 *
 * 방문자에게 남는 값은 화면이 아니라 파일입니다. 그래서 CSV 한 장이 아니라
 *  ① 요약 ② 증빙 공백 목록 ③ 기간·제출 리스크 ④ 비목별 합계 ⑤ 남은 체크리스트
 *  ⑥ 담당 기관에 보낼 요청 메일 초안
 * 을 한 편으로 묶어 만듭니다. 전부 브라우저 안에서 조립되고 아무것도 전송되지 않습니다.
 *
 * 주의 — 숫자는 전부 사용자 자신의 데이터에서 옵니다. 사이트가 검증되지 않은 수치를 게시하는 문제와
 * 무관합니다(게시물이 아니라 본인 정리 자료). 반면 기관에 보내는 요청 초안의 사업명·기관명·담당자 같은
 * 값은 제가 알 수 없으므로 〔대괄호〕 자리표시자로 남깁니다. 보내기 전에 채워야 한다는 사실을
 * 파일 맨 아래에 한 줄로 적어 두었습니다.
 */
import { computeTotals, evidenceGapList, formatKRW, currentPeriod } from './receipts';
import type { ReceiptEntry, Group, Totals } from './receipts';

export interface BundleInput {
  /** 필터까지 적용된 결과만 넣습니다. */
  entries: ReceiptEntry[];
  /** 체크리스트 완료 여부 (key → value) */
  checklist: Record<string, boolean>;
  /** 체크리스트 항목 정의 — 화면과 같은 출처에서 전달받습니다(이 파일이 데이터 파일을 직접 들여오지 않게 떼어 놓았습니다). */
  items: { id: string; label: string }[];
  /** 파일 이름에 쓸 기간 (예: 2026-10). 없으면 이번 달. */
  period?: string;
  generatedAt?: Date;
}

const DASH = '—';

function kv(label: string, value: string): string {
  return `- ${label}: ${value}`;
}

/** 표 한 덩어리를 고정 폭 텍스트로 만듭니다. 메모장·엑셀 어디서나 읽히게 컬럼을 맞춰 줍니다. */
function textTable(head: string[], rows: string[][]): string {
  // 사용자 입력(메모·거래처) 에 개행이 섞이면 컬럼 정렬이 아니라 행 자체가 갈라집니다. 한 줄로 줄여 붙입니다.
  const flat = (v: string) => (v ?? '').replace(/[\r\n]+/g, ' ');
  const flatHead = head.map(flat);
  const flatRows = rows.map((r) => r.map(flat));
  const widths = flatHead.map((_, i) => Math.max(0, ...[flatHead, ...flatRows].map((r) => (r[i] ?? '').length)));
  const line = (r: string[]) => r.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd();
  return [line(flatHead), line(widths.map((w) => DASH.repeat(Math.min(w, 12))))]
    .concat(flatRows.map(line))
    .join('\n');
}

function gapRows(entries: ReceiptEntry[]): string[][] {
  return evidenceGapList(entries).map((e) => [
    e.date,
    e.vendor || '(거래처 미입력)',
    e.approvalNo || DASH,
    formatKRW(e.amount),
    e.evidenceType,
    e.evidenceState
  ]);
}

function riskRows(entries: ReceiptEntry[]): string[][] {
  return entries
    .filter((e) => e.periodState === '기간 외' || e.periodState === '확인 필요')
    .map((e) => [
      e.date,
      e.vendor || '(거래처 미입력)',
      e.approvalNo || DASH,
      formatKRW(e.amount),
      e.periodState,
      e.memo || ''
    ]);
}

function unsubmittedRows(entries: ReceiptEntry[]): string[][] {
  // 요약의 '제출 전' 값과 같은 기준으로 뽑습니다. 미제출·보완 요청만 걸면 합계 칸과 목록 건수가 어긋납니다.
  return entries
    .filter((e) => e.submitState !== '제출 완료')
    .map((e) => [
      e.date,
      e.vendor || '(거래처 미입력)',
      e.approvalNo || DASH,
      formatKRW(e.amount),
      e.budgetItem || '(비목 미입력)',
      e.submitState
    ]);
}

function totalsBlock(totals: Totals): string {
  return [
    kv('집행 기록', `${totals.count}건`),
    kv('총액', formatKRW(totals.total)),
    // dedicatedRate 는 이미 0~100 정수(화면에 보여주는 값과 같은 척도) — 여기서 다시 곱하면 두 배로 부풀어 오릅니다.
    kv('전용(체크)카드 경로', `${formatKRW(totals.dedicatedTotal)} (${totals.dedicatedRate}%)`),
    kv('증빙 공백(미수취·재요청)', `${totals.evidenceGapCount}건 ${formatKRW(totals.evidenceGapTotal)}`),
    kv('기간 확인 필요·기간 외', `${totals.periodRiskCount}건 ${formatKRW(totals.periodRiskTotal)}`),
    kv('제출 전 (제출 완료 아닌 행)', `${totals.notSubmittedCount}건 ${formatKRW(totals.notSubmittedTotal)}`)
  ].join('\n');
}

function groupBlock(title: string, groups: Group[]): string {
  if (groups.length === 0) return `${title}: 해당 없음`;
  return `${title}\n${textTable(
    [title, '건수', '합계'],
    groups.map((g) => [g.key || '(미입력)', String(g.count), formatKRW(g.total)])
  )}`;
}

function checklistBlock(items: BundleInput['items'], checklist: Record<string, boolean>): string {
  const box = (list: BundleInput['items'], done: boolean) =>
    list.length === 0 ? '  (없음)' : list.map((i) => `  [${done ? 'x' : ' '}] ${i.label}`).join('\n');
  const done = items.filter((i) => checklist[i.id] === true);
  const rest = items.filter((i) => checklist[i.id] !== true);
  return [`이미 끝난 항목 ${done.length}개`, box(done, true), '', `남은 항목 ${rest.length}개`, box(rest, false)].join('\n');
}

/**
 * 담당 기관에 보낼 요청 메일 초안. 증빙이 비어 있는 행을 근거로 만들되,
 * 기관·사업명·담당자처럼 제가 알 수 없는 값은 〔〕 로 남겨 둡니다.
 */
export function buildRequestDraft(entries: ReceiptEntry[], opts: { period?: string; generatedAt?: Date } = {}): string {
  const now = opts.generatedAt ?? new Date();
  const gaps = evidenceGapList(entries);
  const stamp = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;
  return [
    '〔담당 기관명〕 〔담당자 직함·성함〕 귀하',
    '',
    '〔사업명 / 사업번호〕 사업비 집행에 따라 증빙 서류를 정리하던 중, 아래 항목이 아직 확보되지 않아 문의드립니다.',
    '',
    ...(gaps.length > 0
      ? [
          `요청 대상 (집행일순 ${gaps.length}건)`,
          textTable(
            ['지출일', '거래처', '승인번호', '금액', '증빙 종류', '현재 상태'],
            gaps.map((e) => [
              e.date,
              e.vendor || '〔거래처〕',
              e.approvalNo || DASH,
              formatKRW(e.amount),
              e.evidenceType,
              e.evidenceState
            ])
          ),
          ''
        ]
      : ['현재 이 정리 자료상 증빙 공백은 없습니다. 아래 일반 요청만 남깁니다.', '']),
    '확인 부탁드릴 사항',
    '  1. 위 건에 대해 인정되는 증빙 종류(원본/사본, 전자파일 허용 범위) 를 안내해 주세요.',
    '  2. 발급이 어려운 경우 대체 절차(미수취 사유 확인서 등) 가 있는지, 있다면 서식이 무엇인지 알려 주세요.',
    '  3. 제출 기한이 어느 기준(집행일/발급일/접수일)으로 계산되는지 확인하고 싶습니다.',
    '',
    opts.period ? `정산 대상 기간: ${opts.period}` : '정산 대상 기간: 〔예: 2026-07 ~ 2026-12〕',
    `정리 작성 시각: ${stamp}`,
    '',
    '※ 이 초안은 참여자가 자신의 집행 기록을 정리해 만든 초안입니다. 기관 안내 문구·서식이 우선입니다.',
    '※ 보내기 전에 〔〕 안의 값을 채우고, 금액·거래처가 실제와 일치하는지 확인해 주세요.'
  ].join('\n');
}

/** 한 편으로 묶은 정산 꾸러미 텍스트. */
export function buildBundle(input: BundleInput): string {
  const entries = Array.isArray(input.entries) ? input.entries : [];
  const items = Array.isArray(input.items) ? input.items : [];
  const checklist = input.checklist && typeof input.checklist === 'object' ? input.checklist : {};
  const period = input.period || currentPeriod(input.generatedAt ?? new Date());
  const totals = computeTotals(entries);
  const gaps = gapRows(entries);
  const risks = riskRows(entries);
  const open = unsubmittedRows(entries);
  return [
    '모두의 창업 정산 꾸러미 (비공식 — 참여자 자체 정리 자료)',
    `기간: ${period}`,
    '출처: 이 파일의 숫자는 전부 사용자 입력(이 브라우저에 저장된 집행 기록) 에서 나왔습니다. 공식 제출 서식을 대체하지 않습니다.',
    '',
    '1. 요약',
    totals.count === 0 ? '  (집행 기록이 없습니다. 입력 후 다시 내보내세요.)' : totalsBlock(totals),
    '',
    '2. 증빙 공백 목록',
    gaps.length === 0
      ? '  없음'
      : textTable(['지출일', '거래처', '승인번호', '금액', '증빙 종류', '수취 상태'], gaps),
    '',
    '3. 기간 리스크 (기간 외 / 확인 필요)',
    risks.length === 0 ? '  없음' : textTable(['지출일', '거래처', '승인번호', '금액', '집행 기간', '메모'], risks),
    '',
    '4. 제출 전 항목 (제출 완료 아닌 것)',
    open.length === 0 ? '  없음' : textTable(['지출일', '거래처', '승인번호', '금액', '비목', '제출 상태'], open),
    '',
    '5. 비목별 합계',
    groupBlock('비목', totals.byBudgetItem),
    '',
    '6. 결제경로별 합계',
    groupBlock('결제경로', totals.byPayMethod),
    '',
    '7. 달별 합계',
    groupBlock('월', totals.byMonth),
    '',
    '8. 체크리스트',
    items.length === 0 ? '  (체크리스트 항목을 받지 못해 이 절은 비었습니다)' : checklistBlock(items, checklist),
    '',
    '9. 담당 기관에 보낼 요청 초안',
    buildRequestDraft(entries, { period, generatedAt: input.generatedAt })
  ].join('\n');
}

/**
 * 기간 필터가 없을 때의 정산 기간. 이번 달을 기본값으로 적는 대신, 실제로 들어 있는 집행일의
 * 최소~최대 달에서 만듭니다 — 기관에 보내는 파일의 '기간' 칸이 데이터와 다른 달이면 오해가 됩니다.
 */
export function dataPeriod(entries: ReceiptEntry[], now: Date = new Date()): string {
  const months = entries.map((e) => (typeof e.date === 'string' ? e.date.slice(0, 7) : '')).filter((m) => /^\d{4}-\d{2}$/.test(m));
  if (months.length === 0) return currentPeriod(now);
  months.sort();
  const first = months[0];
  const last = months[months.length - 1];
  return first === last ? first : `${first}~${last}`;
}

/** 파일 이름에 남는 문자만 골라 씁니다(CSV 규칙과 같은 방식). */
export function bundleFileName(period: string, now: Date = new Date()): string {
  const safe = (period || '')
    .replace(/[^0-9A-Za-z_~-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  return `kkureomi_${safe || 'all'}_${stamp}.txt`;
}
