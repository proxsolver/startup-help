/**
 * 정산·제출 준비 항목.
 *
 * ⚠️ 제출 기한·시점·제재는 사업 공고와 담당 주관기관 지침 기준이므로,
 *    1차 출처 검증 전에는 dueText 를 null 로 두고 "확인 필요" 만 표시합니다.
 */

export type Stage = 'apply' | 'execute' | 'settle';

export interface ScheduleItem {
  id: string;
  label: string;
  detail: string;
  /** 검증된 기한 문자열. 없으면 null. */
  dueText: string | null;
  verification: 'verified' | 'pending';
  appliesTo: Stage[];
  source: { label: string; url: string };
}

const MODOO = { label: '모두의 창업', url: 'https://modoo.or.kr' };
const KISED = { label: '창업진흥원', url: 'https://www.kised.or.kr' };
const BIZINFO = { label: '기업마당', url: 'https://www.bizinfo.go.kr' };
const HTS = { label: '홈택스', url: 'https://www.hometax.go.kr' };

export const SCHEDULE_ITEMS: ScheduleItem[] = [
  {
    id: 'agreement',
    label: '협약·사업기간 확인',
    detail: '집행 기간의 시작일과 종료일을 캘린더에 먼저 넣습니다. 모든 지출이 이 기간 안/밖으로 갈립니다.',
    dueText: null,
    verification: 'pending',
    appliesTo: ['apply', 'execute'],
    source: MODOO
  },
  {
    id: 'card',
    label: '집행 결제수단 확정',
    detail: '어떤 카드를 쓸지 정합니다. 전용 카드 사용 요구·예외 여정은 사업별로 달라져 확인이 필요합니다.',
    dueText: null,
    verification: 'pending',
    appliesTo: ['execute'],
    source: MODOO
  },
  {
    id: 'budget-lines',
    label: '비목(예산과목) 체계 확정',
    detail: '배정된 예산과목 이름과 정리 도구 분류를 같은 단어로 맞춥니다.',
    dueText: null,
    verification: 'pending',
    appliesTo: ['execute'],
    source: KISED
  },
  {
    id: 'monthly-close',
    label: '월별 집행내역 마감',
    detail: '매달 결제·수취·제출 상태를 정리해 대조표 한 장을 남깁니다. 기한은 자체 규칙으로 운영 가능합니다.',
    dueText: '매월 (자체 규칙)',
    verification: 'verified',
    appliesTo: ['execute', 'settle'],
    source: { label: '월 마감 루틴', url: 'https://github.com/proxsolver/startup-help' }
  },
  {
    id: 'mid-check',
    label: '중간 점검·진행 보고',
    detail: '주관기관별 점검 일정이 있습니다. 배정 기관 공지로 확인해야 합니다.',
    dueText: null,
    verification: 'pending',
    appliesTo: ['execute'],
    source: KISED
  },
  {
    id: 'settlement',
    label: '정산 서류 제출',
    detail: '집행내역 + 증빙 대응표 + 인건비 세트를 꾸러미로 만듭니다. 제출 시점·서식은 지침 기준입니다.',
    dueText: null,
    verification: 'pending',
    appliesTo: ['settle'],
    source: MODOO
  },
  {
    id: 'supplement',
    label: '보완 요구 처리',
    detail: '요구받은 항목을 도구에서 상태 `보완 요청` 으로 추적합니다. 요구 기한은 공지 기준입니다.',
    dueText: null,
    verification: 'pending',
    appliesTo: ['settle'],
    source: KISED
  },
  {
    id: 'result-report',
    label: '결과 보고·증빙 제출',
    detail: '작업물·실적 증빙을 제출하는 단계입니다. 항목과 형식은 담당 기관 양식을 따릅니다.',
    dueText: null,
    verification: 'pending',
    appliesTo: ['settle'],
    source: MODOO
  },
  {
    id: 'retention',
    label: '서류 보존 기간 확인',
    detail: '제출 뒤에도 증빙을 보관해야 하는 기간이 정해져 있습니다. 사업·세법 기준이 달라 확인이 필요합니다.',
    dueText: null,
    verification: 'pending',
    appliesTo: ['settle'],
    source: BIZINFO
  },
  {
    id: 'refund',
    label: '미사용분·불인정분 정산',
    detail: '반납·환수 관련 절차가 있는지, 어떤 항목이 문제되는지는 지침 확인이 필요합니다.',
    dueText: null,
    verification: 'pending',
    appliesTo: ['settle'],
    source: KISED
  },
  {
    id: 'tax-side',
    label: '세무 처리 확인 (별도 영역)',
    detail: '지원금·보조금의 부가세·소득세 취급과 사업자로서의 신고 기한은 정산과 별개의 세무 사항입니다. 세무 대리인 확인을 권합니다.',
    dueText: null,
    verification: 'pending',
    appliesTo: ['execute', 'settle'],
    source: HTS
  }
];

export function pendingCount(items: ScheduleItem[] = SCHEDULE_ITEMS): number {
  return items.filter((i) => i.verification === 'pending').length;
}
