/**
 * 참여자 단계 체크리스트.
 *
 * 대상: 지원사업(모두의 창업)에 이미 선정되어 사업비를 집행하고 정산·보고를 해야 하는 참여자.
 * 각 항목은 "무엇을 정리해야 하나" 라는 절차 설명입니다.
 * 제출 기한·인정 범위·제재 같은 법적 수치는 넣지 않았습니다. 그런 내용이 필요하면
 * 공식 1차 출처와 함께 guide 문서로 먼저 뽑고, 이 파일에서는 링크만 참조합니다.
 */
import type { Stage } from './schedule';

export interface ChecklistItem {
  id: string;
  label: string;
  why?: string;
  link?: { label: string; url: string };
  guide?: string;
}

export interface ChecklistStage {
  id: string;
  title: string;
  intro: string;
  audience: Stage[];
  items: ChecklistItem[];
}

const MODOO = { label: '모두의 창업', url: 'https://modoo.or.kr' };
const KISED = { label: '창업진흥원', url: 'https://www.kised.or.kr' };
const BIZINFO = { label: '기업마당', url: 'https://www.bizinfo.go.kr' };

export const CHECKLIST: ChecklistStage[] = [
  {
    id: 'setup',
    title: '1단계 · 집행 시작 전 확정',
    intro: '첫 영수증을 따기 전에 규칙을 정해 두면, 나중에 정산서 한 장으로 되돌아옵니다.',
    audience: ['apply', 'execute'],
    items: [
      {
        id: 'setup-01',
        label: '협약서에서 사업기간(시작일·종료일)을 옮겨 적었다',
        why: '집행 기간 밖 지출은 정산에서 가장 많이 잘리는 항목입니다. 캘린더에 먼저 박아 두면 이후 입력이 자동 분기됩니다.',
        guide: '/guide/basics/before-you-spend/'
      },
      {
        id: 'setup-02',
        label: '배정된 예산과목 이름을 그대로 비목 목록으로 복사했다',
        why: '정리 도구의 분류어가 서류의 예산과목과 다르면 대조에 시간이 두 배로 듭니다.',
        guide: '/guide/settlement/monthly-close/'
      },
      {
        id: 'setup-03',
        label: '집행 결제수단을 정했다 (전용 카드·계좌, 예외 처리)',
        why: '어느 경로로 결제했는지가 수취 가능한 증빙 종류를 결정합니다.',
        guide: '/guide/expense/payment-channels/',
        link: { label: '모두의 창업 안내', url: MODOO.url }
      },
      {
        id: 'setup-04',
        label: '전용 카드 발급·등록 상태를 실제로 결제해 확인했다',
        why: '발급만 되고 미등록 상태면 일반 개인카드로 처리되어 증빙 종류가 달라집니다.',
        link: { label: '창업진흥원', url: KISED.url }
      },
      {
        id: 'setup-05',
        label: '집행 불가로 안내된 항목·거래처 유형을 메모해 뒀다',
        why: '사유가 반복되는 지출은 아예 발생 전에 막는 편이 낫습니다. 기준은 사업 공고·가이드라인 기준이므로 확인이 필요합니다.',
        link: { label: '기업마당', url: BIZINFO.url }
      }
    ]
  },
  {
    id: 'execute',
    title: '2단계 · 지출 발생 때마다',
    intro: '한 건당 30초 입력 습관. 이 구간에서 놓친 증빙은 정산 단계에서 비용이 가장 크게 돌아옵니다.',
    audience: ['execute'],
    items: [
      {
        id: 'exe-01',
        label: '결제 즉시 영수증 정리에 날짜·거래처·금액·비목을 넣었다',
        why: '기억으로 모으는 기간이 길어질수록 거래처·용도 대응이 틀어집니다.',
        guide: '/tools/receipts/'
      },
      {
        id: 'exe-02',
        label: '받은 증빙 종류를 기록했다 (세금계산서 / 현금영수증 / 카드전표 / 간이영수증)',
        guide: '/guide/expense/evidence-types/'
      },
      {
        id: 'exe-03',
        label: '원본 파일(이미지·PDF)을 비목별로 저장하고, 도구에는 수취 상태로 표시했다',
        why: '정산은 파일로 받습니다. 목록만 있고 파일이 없으면 그 건은 미수취와 같습니다.',
        guide: '/guide/settlement/settlement-package/'
      },
      {
        id: 'exe-04',
        label: '증빙을 못 받은 건은 같은 날 재요청 상태로 넣었다',
        why: '경과일이 지난 발급 요청은 성공률이 낮습니다.',
        guide: '/guide/expense/missing-voucher/'
      },
      {
        id: 'exe-05',
        label: '계약이 필요한 지출은 계약서·견적서를 먼저 확보했다',
        why: '증빙 종류를 `계약서·견적서만` 으로 두면 대조표에서 구멍으로 표시됩니다.',
        guide: '/guide/documents/document-map/'
      },
      {
        id: 'exe-06',
        label: '집행 기간 안/밖 여부를 그 자리에서 판정했다',
        why: '나중에 기간을 역산해서 설득하는 것보다, 결제 시점에 확인하는 편이 쉽습니다.',
        guide: '/guide/basics/before-you-spend/'
      }
    ]
  },
  {
    id: 'settle',
    title: '3단계 · 정산·보고 꾸러미',
    intro: '제출 직전 순서. 아래는 제출 자체보다 대조와 누락 점검에 관한 항목입니다.',
    audience: ['settle'],
    items: [
      {
        id: 'set-01',
        label: '월별로 마감하고 CSV 대조표 한 장을 남겼다',
        guide: '/guide/settlement/monthly-close/'
      },
      {
        id: 'set-02',
        label: '수취구멍(미수취·재요청·사본이미지만) 목록을 뽑아서 처리 순서를 정했다',
        why: '정산에서 실제로 문제가 되는 건 개수가 아니라 금액입니다. 합계로 먼저 보세요.',
        guide: '/tools/receipts/'
      },
      {
        id: 'set-03',
        label: '제출상태를 건별로 갱신했다 (미제출 / 초안 포함 / 제출 완료 / 보완 요청)',
        why: '보완 요구가 들어온 건을 목록으로 되돌려 받아야 합니다.',
        guide: '/guide/settlement/settlement-package/'
      },
      {
        id: 'set-04',
        label: '인건비·외주 지급 관련 서류 세트를 따로 묶었다',
        why: '집행 증빙과 별개의 서류가 필요한 영역입니다. 해당 여부와 서식은 담당 기관 기준을 확인해야 합니다.',
        link: { label: '창업진흥원', url: KISED.url }
      },
      {
        id: 'set-05',
        label: '제출 후 서류 보존 기간을 확인해 캘린더에 넣었다',
        why: '법정 보존기간은 사업과 세법 기준이 달라서 이 사이트에서 값을 확정하지 않았습니다. 담당 기관 안내에서 확인이 필요합니다.',
        link: { label: '모두의 창업 안내', url: MODOO.url }
      },
      {
        id: 'set-06',
        label: '세무 처리는 세무 대리인에게 별도로 확인했다',
        why: '지원금의 부가세·소득세 취급과 사업자로서의 신고 기한은 정산과 별개입니다. 이 사이트는 판단을 대신하지 않습니다.',
        guide: '/disclaimer/'
      }
    ]
  }
];

export function allChecklistItemIds(stages: ChecklistStage[] = CHECKLIST): string[] {
  return stages.flatMap((s) => s.items.map((i) => i.id));
}

export function checklistProgress(
  done: Record<string, boolean>,
  stages: ChecklistStage[] = CHECKLIST
): number {
  const ids = allChecklistItemIds(stages);
  if (ids.length === 0) return 0;
  const n = ids.filter((id) => done[id] === true).length;
  return Math.round((n / ids.length) * 100);
}
