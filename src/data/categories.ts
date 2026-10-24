export const CATEGORY_META = [
  {
    key: 'basics',
    title: '시작 전 확인',
    desc: '돈을 쓰기 전에 정해두면 뒤에 되돌리기 어려운 것들'
  },
  {
    key: 'expense',
    title: '집행·지출증빙',
    desc: '결제 경로별 수취 서류, 못 받은 증빙 되돌리기'
  },
  {
    key: 'settlement',
    title: '정산·보고',
    desc: '월 마감, 집행내역 정리, 정산 제출 흐름'
  },
  {
    key: 'documents',
    title: '문서·서식',
    desc: '무엇을 어디에서 받아 제출하는지 (홈택스·카드사 발급 창구 포함)'
  }
] as const;

export type CategoryKey = (typeof CATEGORY_META)[number]['key'];

export function categoryTitle(key: string): string {
  return CATEGORY_META.find((c) => c.key === key)?.title ?? key;
}

export function categoryDesc(key: string): string {
  return CATEGORY_META.find((c) => c.key === key)?.desc ?? '';
}

/** 참여자가 같은 사업 안에서 거쳐 가는 단계 라벨 */
export const AUDIENCE_LABEL: Record<string, string> = {
  apply: '신청·선정',
  execute: '집행·지출',
  settle: '정산·보고'
};
