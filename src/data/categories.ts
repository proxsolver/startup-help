export const CATEGORY_META = [
  { key: 'receipts', title: '영수증·지출증빙', desc: '무엇을 받아야 하고, 어떻게 정리하는지에 대한 안내' },
  { key: 'documents', title: '창업 문서', desc: '사업자등록·인허가·4대보험·발급 창구' },
  { key: 'tax', title: '신고 준비', desc: '캘린더 해석과 자료 준비 순서' },
  { key: 'launch', title: '개업 초기', desc: '첫 90일 배치와 습관 만들기' }
] as const;

export type CategoryKey = (typeof CATEGORY_META)[number]['key'];

export function categoryTitle(key: string): string {
  return CATEGORY_META.find((c) => c.key === key)?.title ?? key;
}

export function categoryDesc(key: string): string {
  return CATEGORY_META.find((c) => c.key === key)?.desc ?? '';
}

export const AUDIENCE_LABEL: Record<string, string> = {
  pre: '예비창업자',
  sole: '개인사업자',
  corp: '법인'
};
