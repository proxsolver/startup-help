/**
 * 정산·제출 준비 항목.
 *
 * ⚠️ 제출 기한·시점·제재는 사업 공고·협약서·담당 주관기관 지침(및 세법) 기준이므로,
 *    1차 출처로 확인하기 전에는 dueText 를 null 로 두고 "시점 확인 필요" 만 표시합니다.
 *    (npm run check:content 가 pending 항목에 숫자 기한·금액이 들어가면 빌드를 실패시킵니다)
 *
 * decidedBy 는 "그 값을 어디서 확정할 수 있는가" 입니다. 값 자체보다 이 열이 사용자에게 먼저 쓰입니다.
 */

export type Stage = 'apply' | 'execute' | 'settle';

export interface ScheduleSource {
  label: string;
  url: string;
}

export interface ScheduleItem {
  id: string;
  label: string;
  detail: string;
  /** 검증된 기한 문자열. 없으면 null. */
  dueText: string | null;
  verification: 'verified' | 'pending';
  appliesTo: Stage[];
  /** 값을 확정할 수 있는 자리(협약서·주관기관 공지·원문 등) */
  decidedBy: string;
  sources: ScheduleSource[];
}

const MODOO: ScheduleSource = { label: '모두의 창업 플랫폼', url: 'https://modoo.or.kr' };
const KISED: ScheduleSource = { label: '창업진흥원 사업공고', url: 'https://www.kised.or.kr/menu.es?mid=a10302000000' };
const KSTARTUP: ScheduleSource = { label: 'K-Startup 진행사업 공고', url: 'https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do' };
const MSS_NOTICE: ScheduleSource = { label: '중소벤처기업부 통합 모집공고', url: 'https://www.mss.go.kr/site/smba/ex/bbs/View.do?cbIdx=310&bcIdx=1066642&parentSeq=1066642' };
const OPS_RULE: ScheduleSource = { label: '중소기업창업 지원사업 운영요령 (국가법령정보센터)', url: 'https://www.law.go.kr/LSW/admRulLsInfoP.do?admRulSeq=2100000222594' };
const MGMT_GUIDE: ScheduleSource = { label: '중소기업창업 지원사업 통합관리지침 개정 안내', url: 'https://www.k-startup.go.kr/user/board/webRFRR_view_reference.do?schM=view&id=172153' };
const SUBSIDY_RULE: ScheduleSource = { label: '국고보조금 통합관리지침 (국가법령정보센터)', url: 'https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=2100000275316&chrClsCd=010201' };
const INCOME_ACT: ScheduleSource = { label: '소득세법 원문 (국가법령정보센터)', url: 'https://www.law.go.kr/LSW/lsLawLinkInfo.do?lsJoLnkSeq=1000819819&lsId=001565&chrClsCd=010202' };
const HTS: ScheduleSource = { label: '홈택스', url: 'https://www.hometax.go.kr' };
const NTS: ScheduleSource = { label: '국세청', url: 'https://www.nts.go.kr' };
const SELF: ScheduleSource = { label: '월 마감 루틴 안내 (이 사이트)', url: 'https://proxsolver.github.io/startup-help/guide/settlement/monthly-close/' };

export const SCHEDULE_ITEMS: ScheduleItem[] = [
  {
    id: 'agreement',
    label: '협약·사업기간 확인',
    detail: '집행 기간의 시작일과 종료일을 캘린더에 먼저 넣습니다. 모든 지출이 이 기간 안/밖으로 갈립니다.',
    dueText: null,
    verification: 'pending',
    appliesTo: ['apply', 'execute'],
    decidedBy: '체결한 협약서(사업기간란)',
    sources: [MODOO, MSS_NOTICE]
  },
  {
    id: 'card',
    label: '집행 결제수단 확정',
    detail:
      '창업지원 사업에는 사업비를 전용 카드나 계좌이체로 집행하게 하고 예외를 한정하는 운영요령·지침이 있습니다. 이번 사업에서 어떤 수단을 요구하는지, 현금·개인카드는 인정되는지, 예외 절차는 무엇인지는 협약서와 사업별 세부관리기준이 우선이므로 원문과 담당 기관 공지로 확인해 이 칸을 채우세요.',
    dueText: null,
    verification: 'pending',
    appliesTo: ['execute'],
    decidedBy: '협약서 · 사업별 세부관리기준 · 배정 주관기관 공지',
    sources: [OPS_RULE, MGMT_GUIDE, MODOO]
  },
  {
    id: 'budget-lines',
    label: '비목(예산과목) 체계 확정',
    detail: '배정된 예산과목 이름과 정리 도구 분류를 같은 단어로 맞춥니다. 서류·시스템에 적힌 비목명을 그대로 쓰는 것이 대조 속도를 올립니다.',
    dueText: null,
    verification: 'pending',
    appliesTo: ['execute'],
    decidedBy: '협약서 예산표 · 사업별 세부관리기준 비목 체계',
    sources: [KISED, MGMT_GUIDE]
  },
  {
    id: 'monthly-close',
    label: '월별 집행내역 마감',
    detail: '매달 결제·수취·제출 상태를 정리해 대조표 한 장을 남깁니다. 이 사이트가 권장하는 자체 규칙이며 기관 요구가 아닙니다.',
    dueText: '매월 (자체 권장)',
    verification: 'verified',
    appliesTo: ['execute', 'settle'],
    decidedBy: '이 사이트 권장(기관 요구 아님)',
    sources: [SELF]
  },
  {
    id: 'mid-check',
    label: '중간 점검·진행 보고',
    detail: '일부 창업지원 사업은 협약 기간 중 성과 증빙을 요구하거나 중간 점검 때 예산을 재배분합니다. 이번 사업에 있는지, 언제인지는 배정 기관 공지로만 확인됩니다.',
    dueText: null,
    verification: 'pending',
    appliesTo: ['execute'],
    decidedBy: '배정 주관기관 공지',
    sources: [KISED, KSTARTUP]
  },
  {
    id: 'settlement',
    label: '정산 서류 제출',
    detail: '집행내역 + 증빙 대응표 + 인건비 세트를 꾸러미로 만듭니다. 제출 시점·서식·양식은 지침과 담당 기관 공지가 기준입니다.',
    dueText: null,
    verification: 'pending',
    appliesTo: ['settle'],
    decidedBy: '사업별 세부관리기준 · 담당 주관기관 정산 안내',
    sources: [MGMT_GUIDE, SUBSIDY_RULE, MODOO]
  },
  {
    id: 'supplement',
    label: '보완 요구 처리',
    detail: '요구받은 항목을 도구에서 상태 `보완 요청` 으로 추적합니다. 보완 요구 기한과 지연 시 조치는 공지 기준입니다.',
    dueText: null,
    verification: 'pending',
    appliesTo: ['settle'],
    decidedBy: '담당 주관기관 공문·공지',
    sources: [KISED, SUBSIDY_RULE]
  },
  {
    id: 'result-report',
    label: '결과 보고·증빙 제출',
    detail: '작업물·실적 증빙을 제출하는 단계입니다. 항목과 형식은 담당 기관 양식을 따릅니다.',
    dueText: null,
    verification: 'pending',
    appliesTo: ['settle'],
    decidedBy: '담당 주관기관 양식·공지',
    sources: [MODOO, KSTARTUP]
  },
  {
    id: 'retention',
    label: '서류 보존 기간 확인',
    detail:
      '제출 뒤에도 증빙을 보관해야 하는 기간이 정해져 있습니다. 지원사업 서류와 세무 증빙은 근거도, 기간을 세기 시작하는 시점도 다르므로 한 줄로 합쳐 적으면 안 됩니다. 지원사업 쪽은 운영요령·통합관리지침, 세무 쪽은 소득세법·부가가치세법을 각각 확인해 두 칸으로 나눠 적으세요.',
    dueText: null,
    verification: 'pending',
    appliesTo: ['settle'],
    decidedBy: '운영요령·지침(지원사업) + 세법(소득·부가)',
    sources: [OPS_RULE, MGMT_GUIDE, INCOME_ACT]
  },
  {
    id: 'refund',
    label: '미사용분·불인정분 정산',
    detail: '정산에서 불인정된 금액·미사용액의 반납 절차와, 목적 외 집행으로 볼 수 있는 경우가 지침에 있습니다. 이번 사업의 적용은 협약서 확인이 필요합니다.',
    dueText: null,
    verification: 'pending',
    appliesTo: ['settle'],
    decidedBy: '협약서 · 정산 결과 통보서',
    sources: [SUBSIDY_RULE, MGMT_GUIDE]
  },
  {
    id: 'tax-side',
    label: '세무 처리 확인 (별도 영역)',
    detail:
      '지원금의 부가세·소득세 취급, 사후 환급금(경정청구·영수증을 못 받은 건 등)의 귀속, 사업자로서의 신고 기한은 정산과 별개의 세무 사항입니다. 일부 사업은 부가세 미환급 서약을 요구합니다. 신고 기한·환급 취급은 국세청·홈택스 안내와 세무 대리인 확인으로 정하세요.',
    dueText: null,
    verification: 'pending',
    appliesTo: ['execute', 'settle'],
    decidedBy: '국세청·홈택스 안내 / 세무 대리인',
    sources: [HTS, NTS, INCOME_ACT]
  }
];

export function pendingCount(items: ScheduleItem[] = SCHEDULE_ITEMS): number {
  return items.filter((i) => i.verification === 'pending').length;
}
