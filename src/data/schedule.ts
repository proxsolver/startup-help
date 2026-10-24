/**
 * 정산·제출 준비 항목.
 *
 * ⚠️ 두 종류의 시점이 섞여 있습니다. 구분해서 채웁니다.
 *  - 세법에서 정한 시점(부가세·종합소득세·원천세, 증빙 보관 기간):
 *    법제처 원문과 국세청 안내를 직접 열어 확인한 것만 dueText 에 적고 verification: 'verified' 로 둡니다.
 *    확인한 조문·시행일은 같은 항목의 decidedBy 와 출처 링크에 남깁니다.
 *  - 지원사업(모두의 창업) 자체가 정하는 시점·요구:
 *    사업 공고·협약서·사업별 세부관리기준·배정 주관기관 공지마다 다르고 자동화로는 원문을 열 수 없습니다.
 *    따라서 dueText 는 null, detail/decidedBy 에 "어디서 확정되는가" 만 적습니다.
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
const INCOME_ACT: ScheduleSource = {
  label: '소득세법 원문 (국가법령정보센터)',
  url: 'https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=280405&efYd=20260701'
};
const VAT_ACT: ScheduleSource = {
  label: '부가가치세법 원문 (국가법령정보센터)',
  url: 'https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=276117&efYd=20260102'
};
const COMMERCIAL_CODE: ScheduleSource = {
  label: '상법 원문 (국가법령정보센터)',
  url: 'https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=273629&efYd=20260910'
};
const NTS_VAT: ScheduleSource = {
  label: '국세청 부가가치세 신고·납부 기한 안내',
  url: 'https://www.nts.go.kr/nts/cm/cntnts/cntntsView.do?mi=2273&cntntsId=7694'
};
const NTS_INCOME: ScheduleSource = {
  label: '국세청 종합소득세 신고·납부 기한 안내',
  url: 'https://www.nts.go.kr/nts/cm/cntnts/cntntsView.do?mi=2225&cntntsId=7665'
};
const NTS_WITHHOLD: ScheduleSource = {
  label: '국세청 원천세 신고·납부 기한 안내',
  url: 'https://www.nts.go.kr/nts/cm/cntnts/cntntsView.do?mi=2414&cntntsId=7702'
};
const HTS: ScheduleSource = { label: '홈택스', url: 'https://www.hometax.go.kr' };
const NTS: ScheduleSource = { label: '국세청', url: 'https://www.nts.go.kr' };
const SELF: ScheduleSource = { label: '월 마감 루틴 안내 (이 사이트)', url: 'https://proxsolver.github.io/startup-help/guide/settlement/monthly-close/' };
const CARD_DOC: ScheduleSource = {
  label: '신한카드에서 집행 내역·증빙 받기 (이 사이트)',
  url: 'https://proxsolver.github.io/startup-help/guide/documents/shinhan-card-records/'
};

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
      '창업 지원사업에는 사업비를 전용 카드나 계좌이체로 집행하게 하고 예외를 한정하는 규칙이 있다고 알려진 경우가 많지만, 이 사이트는 그 원문(중소기업창업 지원사업 운영요령·사업별 세부관리기준)을 아직 열지 못했습니다. 그래서 요구 수단·인정 범위·예외 절차·제재를 여기서 단정하지 않습니다. 배정된 협약서와 담당 주관기관 공지가 우선이고, 확인되면 이 칸에 시점과 기준선을 적습니다.',
    dueText: null,
    verification: 'pending',
    appliesTo: ['execute'],
    decidedBy: '협약서 · 사업별 세부관리기준 · 배정 주관기관 공지',
    sources: [OPS_RULE, MGMT_GUIDE, MODOO]
  },
  {
    id: 'card-records',
    label: '카드사 자료 확보 창구 확정',
    detail:
      '카드 명의(개인·개인사업자·법인)별로 어떤 자료를 어떤 계정에서 받을 수 있는지 집행 전에 정해 둡니다. 발급 창구·권한·조회 범위는 카드사 정책 사항이라 이 사이트가 단정하지 않고, 실제로 열어 확인한 회사 안내만 문서로 적었습니다. 요구하는 서류 이름은 담당 기관에서 먼저 받아 카드사 요청서에 그대로 씁니다.',
    dueText: null,
    verification: 'pending',
    appliesTo: ['execute', 'settle'],
    decidedBy: '카드사 안내 페이지·고객센터 · 협약서상 요구 서류 이름',
    sources: [CARD_DOC, MODOO]
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
    id: 'retention-tax',
    label: '세무 증빙 보관 (사업자로서)',
    detail:
      '사업소득·기타소득의 필요경비로 인정받으려는 지출은 그 증명서류를 받아 보관해야 합니다. 보관 기간과 기산점이 법에 적혀 있어 아래 칸은 채웠습니다. 다만 지원사업 정산에서 요구하는 보존 기간은 별개라 위의 "지원사업 서류 보존" 칸을 함께 봐야 합니다.',
    dueText: '확정신고기간 종료일부터 5년간 (소득세법 제160조의2①)',
    verification: 'verified',
    appliesTo: ['execute', 'settle'],
    decidedBy: '소득세법 제160조의2① 원문 확인 (확인 2026-10-24, 현행 시행 기준)',
    sources: [INCOME_ACT]
  },
  {
    id: 'retention-books',
    label: '장부·중요서류 보존 (상법)',
    detail:
      '세법이 정한 증빙 보관과 별도로, 상인은 상업장부와 영업에 관한 중요서류를 10년, 전표 또는 이와 유사한 서류를 5년간 보존해야 합니다(제33조①). 기산점은 조문이 상업장부에 대해서만 "그 폐쇄한 날로부터"라고 적고 있습니다(제33조②) — 전표·중요서류의 기산점은 이 조문에 없습니다. 장부·서류를 마이크로필름·전산정보처리조직으로 보존할 수 있고 그 방법 등은 대통령령으로 정합니다(제33조③·④).',
    dueText: '상업장부·중요서류 10년, 전표 또는 이와 유사한 서류 5년 (상법 제33조①)',
    verification: 'verified',
    appliesTo: ['execute', 'settle'],
    decidedBy: '상법 제33조①·② 원문 확인 (확인 2026-10-24, 현행 시행 기준)',
    sources: [COMMERCIAL_CODE]
  },
  {
    id: 'retention-vat',
    label: '부가세 장부·세금계산서 보존',
    detail:
      '소득세법상 지출증빙 보관과 근거 조문은 다르지만 기간은 같은 5년 축에 속합니다. 부가세 장부와 발급·수취한 세금계산서·수입세금계산서·영수증을 해당 과세기간 확정신고 기한 뒤 5년간 보존해야 합니다. 전자세금계산서 발급 명세를 국세청에 전송한 경우는 법이 정한 예외가 있습니다.',
    dueText: '해당 과세기간 확정신고 기한 후 5년간 (부가가치세법 제71조③)',
    verification: 'verified',
    appliesTo: ['execute', 'settle'],
    decidedBy: '부가가치세법 제71조③ 원문 확인 (확인 2026-10-24, 현행 시행 기준)',
    sources: [VAT_ACT]
  },
  {
    id: 'retention-grant',
    label: '지원사업 서류 보존 기간',
    detail:
      '정산 제출 뒤에도 지원사업 서류를 보관해야 하는 기간이 별도로 있습니다. 근거는 중소기업창업 지원사업 운영요령과 사업별 세부관리기준·협약서이고, 세법의 보관 기간과 기산점이 다릅니다. 한 줄로 합쳐 적지 말고 이 칸을 원문 확인으로 채우세요.',
    dueText: null,
    verification: 'pending',
    appliesTo: ['settle'],
    decidedBy: '운영요령 · 사업별 세부관리기준 · 협약서',
    sources: [OPS_RULE, MGMT_GUIDE, SUBSIDY_RULE]
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
    id: 'vat-return',
    label: '부가가치세 확정신고·납부',
    detail:
      '사업자로서 과세기간(1~6월, 7~12월)의 확정 신고를 하는 자리입니다. 법정 기한은 과세기간이 끝난 후 25일 이내이고, 국세청은 일반과세자 기준 1기는 7월 1일~25일, 2기는 다음 해 1월 1일~25일로 안내합니다. 기한 마지막 날이 주말·공휴일이면 넘어가고, 국세청이 소규모 사업자의 납부기한을 직권으로 미루는 일이 해마다 있어 해당 기간의 공지를 함께 확인해야 합니다.',
    dueText: '과세기간 종료 후 25일 이내 (국세청 안내: 1기 7.1.~7.25., 2기 다음 해 1.1.~1.25.)',
    verification: 'verified',
    appliesTo: ['execute', 'settle'],
    decidedBy: '부가가치세법 제49조① 원문 + 국세청 부가세 신고납부기한 안내 (확인 2026-10-24)',
    sources: [VAT_ACT, NTS_VAT, HTS]
  },
  {
    id: 'income-tax-return',
    label: '종합소득세 확정신고',
    detail:
      '사업소득이 있는 개인사업자는 그 해 소득을 다음 해 5월에 신고합니다. 지원사업에서 받은 돈의 취급(보조금인지, 소득인지)과 필요경비 범위는 정산 결과와 세무 처리가 엇갈릴 수 있는 지점이라 신고 전에 집행 내역을 정리해 두는 편이 좋습니다.',
    dueText: '다음 해 5월 1일 ~ 5월 31일 (소득세법 제70조①)',
    verification: 'verified',
    appliesTo: ['settle'],
    decidedBy: '소득세법 제70조① 원문 + 국세청 종합소득세 안내 (확인 2026-10-24)',
    sources: [INCOME_ACT, NTS_INCOME, HTS]
  },
  {
    id: 'withholding-return',
    label: '원천소득세 신고·납부 (직원·외주 대가)',
    detail:
      '근로·인건비나 원천징수 대상 대가를 지급했다면 지급일이 속하는 달의 다음 달에 신고·납부합니다. 반기 납부 대상자는 1~6월분이 7월 10일, 7~12월분이 1월 10일입니다. 인건비 집행이 있는 달에는 정산 서류와 별도 절차입니다.',
    dueText: '지급일이 속하는 달의 다음 달 10일 (반기납부 특례: 1~6월분 7.10., 7~12월분 1.10.)',
    verification: 'verified',
    appliesTo: ['execute', 'settle'],
    decidedBy: '소득세법(원천징수) + 국세청 원천세 신고납부기한 안내 (확인 2026-10-24)',
    sources: [NTS_WITHHOLD, INCOME_ACT, HTS]
  },
  {
    id: 'cash-receipt',
    label: '현금영수증 의무발급',
    detail:
      '대상 업종 사업자(대통령령으로 정하는 업종)는 건당 거래금액이 이 선 이상이면 상대가 요구하지 않아도 현금영수증을 발급해야 합니다. 개인카드·현금 집행이 많은 경우 이 의무가 먼저인지라, 발급을 못 받은 건은 미수취로 두고 재요청 목록에 올려 두세요.',
    dueText: '건당 거래금액(부가가치세액 포함) 10만원 이상 (소득세법 제162조의3④)',
    verification: 'verified',
    appliesTo: ['execute'],
    decidedBy: '소득세법 제162조의3④ 원문 확인 (대상 업종은 대통령령, 확인 2026-10-24)',
    sources: [INCOME_ACT, NTS, HTS]
  },
  {
    id: 'tax-side',
    label: '지원금의 세무 취급 (별도 확인)',
    detail:
      '지원금 자체의 부가세·소득세 취급, 집행한 부가세의 환급 가능 여부와 미환급 서약, 경정청구로 되받을 수 있는 범위는 위 신고 기한과 별개의 문제입니다. 사업별로 요구하는 확인서가 다르고 국세청 일반 안내로도 확정되지 않으므로 세무 대리인과 협약서 조건을 함께 봐야 합니다.',
    dueText: null,
    verification: 'pending',
    appliesTo: ['execute', 'settle'],
    decidedBy: '협약서·공고 조건 + 세무 대리인 확인',
    sources: [HTS, NTS, INCOME_ACT]
  }
];

export function pendingCount(items: ScheduleItem[] = SCHEDULE_ITEMS): number {
  return items.filter((i) => i.verification === 'pending').length;
}
