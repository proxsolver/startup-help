/**
 * 신고·납부 일정 데이터.
 *
 * ⚠️ 기한·기준액·한도 같은 수치는 1차 출처 검증 없이 게시하지 않습니다.
 *    검증이 끝날 때까지 dueText 는 null 이고, 화면에는 "기한 확인 필요" 와 공식 링크만 나옵니다.
 *    연구 검증 결과가 들어오면 이 파일에 값과 출처를 채우고 verification 을 'verified' 로 바꿉니다.
 */

export type Audience = 'pre' | 'sole' | 'corp';

export interface TaxEvent {
  id: string;
  label: string;
  /** 누구에게 해당되는 항목인지 한 줄로 설명합니다. 법적 판단이 아닌 안내 문구입니다. */
  detail: string;
  dueText: string | null;
  verification: 'verified' | 'pending';
  appliesTo: Audience[];
  source: { label: string; url: string };
}

const NTS = { label: '국세청', url: 'https://www.nts.go.kr' };
const HTS = { label: '홈택스', url: 'https://www.hometax.go.kr' };
const LAW = { label: '국가법령정보센터', url: 'https://www.law.go.kr' };

export const TAX_EVENTS: TaxEvent[] = [
  {
    id: 'business-registration',
    label: '사업자등록 신청',
    detail: '사업 개시 전후로 등록하는 절차입니다. 개시 시점에 따라 신청 기한이 달라져서 기한 수치는 확인이 필요합니다.',
    dueText: null,
    verification: 'pending',
    appliesTo: ['pre', 'sole', 'corp'],
    source: { label: '홈택스 사업자등록 신청', url: 'https://www.hometax.go.kr' }
  },
  {
    id: 'vat-expected',
    label: '부가가치세 예정신고',
    detail: '일반과세자의 연 2회 신고 중 상반기분입니다. 월말·연장 여부는 확인이 필요합니다.',
    dueText: null,
    verification: 'pending',
    appliesTo: ['sole', 'corp'],
    source: HTS
  },
  {
    id: 'vat-final',
    label: '부가가치세 확정신고',
    detail: '연 2회 신고의 연간 확정 단계입니다. 간이과세자는 대상·주기가 다르므로 함께 확인해야 합니다.',
    dueText: null,
    verification: 'pending',
    appliesTo: ['sole', 'corp'],
    source: HTS
  },
  {
    id: 'comprehensive-income',
    label: '종합소득세 확정신고',
    detail: '개인사업자의 사업·이자·배당·근로 등을 합산해 신고합니다. 신고 기간은 확인이 필요합니다.',
    dueText: null,
    verification: 'pending',
    appliesTo: ['sole'],
    source: NTS
  },
  {
    id: 'withholding',
    label: '원천소득세 신고·납부',
    detail: '직원·프리랜서에게 지급한 금액에서 원천징수한 세액을 신고납부합니다. 매월 납부 방식과 반기 납부 선택 제도가 알려져 있어 본인 해당 여부를 확인해야 합니다.',
    dueText: null,
    verification: 'pending',
    appliesTo: ['sole', 'corp'],
    source: HTS
  },
  {
    id: 'securities-submission',
    label: '간이지급명세서 등 제출',
    detail: '지급명세서 종류별로 제출 주기가 다릅니다. 항목을 나눠 확인해야 합니다.',
    dueText: null,
    verification: 'pending',
    appliesTo: ['sole', 'corp'],
    source: HTS
  },
  {
    id: 'book-retention',
    label: '장부·증빙 보관',
    detail: '세무조사·경정청구 대비해 거래증빙과 장부를 보존해야 합니다. 법정 보존기간은 확인이 필요합니다.',
    dueText: null,
    verification: 'pending',
    appliesTo: ['sole', 'corp'],
    source: LAW
  },
  {
    id: 'cash-receipt-duty',
    label: '현금영수증 발급 의무 확인',
    detail: '업종과 매출 규모에 따라 발급 의무가 발생한다는 것이 알려져 있습니다. 대상 기준은 확인이 필요합니다.',
    dueText: null,
    verification: 'pending',
    appliesTo: ['sole', 'corp'],
    source: NTS
  },
  {
    id: 'small-scope',
    label: '간이과세자 적용 기준 확인',
    detail: '매출액 기준에 따라 부가세 부담과 신고 방식이 달라집니다. 개정 이력이 많아 최신 값 확인이 필수입니다.',
    dueText: null,
    verification: 'pending',
    appliesTo: ['pre', 'sole'],
    source: NTS
  }
];

export function pendingCount(events: TaxEvent[] = TAX_EVENTS): number {
  return events.filter((e) => e.verification === 'pending').length;
}
