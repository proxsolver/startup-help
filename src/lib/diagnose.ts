/**
 * 3문 진단 → 다음에 할 일 목록.
 *
 * 이 사이트의 유료 레이어에서 방문자에게 값을 만들어 주는 첫 번째 지점입니다.
 * "어디서부터 손대야 할지 모르겠다" 는 참여자에게 세 가지 질문만으로 동선을 돌려 주고,
 * 그 동선은 전부 이 사이트에 이미 있는 문서·도구로만 갑니다 (없는 주소, 지어낸 절차는 넣지 않습니다).
 *
 * 화면은 이 함수를 부르고, 테스트는 이 함수만 봅니다. 라우팅 지식을 JSX 에 섞지 않려는 목적입니다.
 */
import { CHECKLIST } from '../data/checklists';
import type { ChecklistItem } from '../data/checklists';

export type StageAnswer = 'before' | 'execute' | 'settle';
export type BlockAnswer = 'evidence' | 'deadline' | 'amounts' | 'format';
export type HaveAnswer = 'card' | 'mixed' | 'none';

export interface Diagnosis {
  stage: StageAnswer;
  block: BlockAnswer;
  have: HaveAnswer;
}

export interface NextStep {
  /** 목록 key 로 쓰는 안정 id */
  id: string;
  title: string;
  /** 이 사이트에 실제로 존재하는 경로만 (check:dist 가 없는 주소는 빌드에서 잡습니다) */
  href: string;
  why: string;
}

const STAGE_LABEL: Record<StageAnswer, string> = {
  before: '집행 전',
  execute: '집행 중',
  settle: '정산·보고 앞'
};

const BLOCK_LABEL: Record<BlockAnswer, string> = {
  evidence: '증빙이 안 모인다',
  deadline: '뭘 언제 내야 하는지 모르겠다',
  amounts: '금액이 정리되지 않는다',
  format: '제출 형식이 두렵다'
};

const HAVE_LABEL: Record<HaveAnswer, string> = {
  card: '카드전표 위주',
  mixed: '현금·계좌이체가 섞였다',
  none: '아직 아무것도 없다'
};

const STEP: Record<string, NextStep> = {
  beforeYouSpend: {
    id: 'before-you-spend',
    title: '돈을 쓰기 전에 정해두면 좋은 것',
    href: '/guide/basics/before-you-spend/',
    why: '집행 전에 경로를 정해 두면 뒤에 증빙으로 되돌리기 어려운 선택을 피합니다.'
  },
  evidenceTypes: {
    id: 'evidence-types',
    title: '결제 경로별로 받아 두는 서류',
    href: '/guide/expense/evidence-types/',
    why: '어떤 경로로 냈는지 따라 받아야 할 증빙 종류가 달라집니다.'
  },
  missingVoucher: {
    id: 'missing-voucher',
    title: '못 받은 증빙 되돌리기',
    href: '/guide/expense/missing-voucher/',
    why: '미수취를 어떤 순서로 되돌리는지 절차대로 정리해 두었습니다.'
  },
  paymentChannels: {
    id: 'payment-channels',
    title: '결제 경로와 전용 카드',
    href: '/guide/expense/payment-channels/',
    why: '경로 구분이 잡혀야 금액 집계와 증빙 대조가 한 번에 됩니다.'
  },
  cardRecords: {
    id: 'card-records',
    title: '카드사에서 서류 받아오기',
    href: '/guide/documents/card-records/',
    why: '카드전표·매출전표를 어디서 얼마나 받는지가 정해져야 공백을 셀 수 있습니다. 이 사이트에 신한카드 창구를 열어 확인해 둔 내역이 있습니다.'
  },
  issuingChannels: {
    id: 'issuing-channels',
    title: '종류별로 서류 받아오는 창구',
    href: '/guide/documents/issuing-channels/',
    why: '현금·계좌이체가 섞이면 결제 경로마다 수취 서류가 다릅니다. 카드 내역·현금영수증·세금계산서를 어디서 뽑는지 창구로 정리해 두었습니다.'
  },
  monthlyClose: {
    id: 'monthly-close',
    title: '월 마감 루틴',
    href: '/guide/settlement/monthly-close/',
    why: '정산 앞에서 한꺼번에 하지 않고 달 단위로 접는 방법입니다.'
  },
  settlementPackage: {
    id: 'settlement-package',
    title: '정산 제출 꾸러미',
    href: '/guide/settlement/settlement-package/',
    why: '무엇을 어떤 순서로 묶어 내는지의 기준을 먼저 잡습니다.'
  },
  documentMap: {
    id: 'document-map',
    title: '문서 지도',
    href: '/guide/documents/document-map/',
    why: '어떤 문서가 어디에서 나오는지만 먼저 확인하면 헤매는 시간이 줄어듭니다.'
  },
  taxObligations: {
    id: 'tax-obligations',
    title: '세법이 정한 신고 기한과 보관 기간',
    href: '/guide/settlement/tax-obligations/',
    why: '지원사업 마감과 세법 기한은 다른 기준이라 두 줄로 관리해야 합니다.'
  },
  receiptsTool: {
    id: 'receipts-tool',
    title: '집행 정리 도구',
    href: '/tools/receipts/',
    why: '지금 가진 전표를 입력하면 공백·기간·제출 상태가 숫자로 나옵니다.'
  },
  checklistTool: {
    id: 'checklist-tool',
    title: '참여자 단계 체크리스트',
    href: '/tools/checklist/',
    why: '다음에 무엇을 확인해야 하는지 화면 위에 남기는 도구입니다.'
  },
  calendar: {
    id: 'calendar',
    title: '일정 달력',
    href: '/calendar/',
    why: '제출 시점은 지원사업과 세법이 다른데, 달력에서 두 종류를 구분해 봅니다.'
  }
};

/** 체크리스트 단계 id → 진단 단계. setup/execute/settle 세 단계를 진단 단계와 묶습니다. */
const STAGE_TO_CHECKLIST: Record<StageAnswer, string> = {
  before: 'setup',
  execute: 'execute',
  settle: 'settle'
};

/**
 * 화면에서 넘기는 입력. select 값이라 타입이 좁아지지 않으므로 문자열·null 을 그대로 받고,
 * 아래 pick 이 실제 답변 값만 골라냅니다 (엉뚱한 값은 기본 동선으로 돌아갑니다).
 */
export type DiagnosisInput = { stage?: string | null; block?: string | null; have?: string | null };

/** 질문 답변이 빠지거나 이상한 값이 와도 화면이 죽지 않게 기본값으로 돌립니다. */
function pick<T extends string>(value: string | null | undefined, allowed: Record<T, string>, fallback: T): T {
  return value && Object.prototype.hasOwnProperty.call(allowed, value) ? (value as T) : fallback;
}

/** stage+block+have 를 읽어 다음에 할 일 순서로 펴냅니다. */
export function nextSteps(d: DiagnosisInput): NextStep[] {
  const stage = pick<StageAnswer>(d.stage, STAGE_LABEL, 'execute');
  const block = pick<BlockAnswer>(d.block, BLOCK_LABEL, 'evidence');
  const have = pick<HaveAnswer>(d.have, HAVE_LABEL, 'none');

  const out: NextStep[] = [];
  const push = (step: NextStep) => {
    if (!out.some((s) => s.id === step.id)) out.push(step);
  };

  if (stage === 'before') push(STEP.beforeYouSpend);

  if (block === 'evidence') {
    push(STEP.evidenceTypes);
    push(STEP.missingVoucher);
    push(have === 'card' ? STEP.cardRecords : STEP.paymentChannels);
  } else if (block === 'deadline') {
    push(STEP.calendar);
    push(STEP.documentMap);
    push(STEP.taxObligations);
  } else if (block === 'amounts') {
    push(STEP.receiptsTool);
    push(STEP.monthlyClose);
    push(have === 'mixed' ? STEP.paymentChannels : STEP.evidenceTypes);
  } else {
    push(STEP.settlementPackage);
    push(STEP.documentMap);
    push(STEP.monthlyClose);
  }

  if (have === 'none') push(STEP.checklistTool);
  if (have === 'mixed') push(STEP.issuingChannels);
  if (stage === 'settle') push(STEP.settlementPackage);

  return out.slice(0, 4);
}

/** 진단 요약 문장 (사람이 읽는 한 줄). */
export function diagnosisSummary(d: DiagnosisInput): string {
  const stage = pick<StageAnswer>(d.stage, STAGE_LABEL, 'execute');
  const block = pick<BlockAnswer>(d.block, BLOCK_LABEL, 'evidence');
  const have = pick<HaveAnswer>(d.have, HAVE_LABEL, 'none');
  return `${STAGE_LABEL[stage]} · 막힌 곳: ${BLOCK_LABEL[block]} · 가진 것: ${HAVE_LABEL[have]}`;
}

/** 결과 페이지에서 "남은 체크리스트 항목" 을 보여 주기 위한 원본 항목 (라벨·이유만 씁니다). */
export function checklistItemsForStage(stage: StageAnswer): ChecklistItem[] {
  const key = STAGE_TO_CHECKLIST[pick<StageAnswer>(stage, STAGE_LABEL, 'execute')];
  const found = CHECKLIST.find((s) => s.id === key);
  return found ? found.items : [];
}

/** 라벨 → 값 역조회 (테스트·디버깅용). */
export function answerLabels(): Record<string, string> {
  return { ...STAGE_LABEL, ...BLOCK_LABEL, ...HAVE_LABEL };
}
