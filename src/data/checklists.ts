/**
 * 창업 단계 체크리스트.
 * 각 항목은 "무엇을 해야 하나" 라는 절차 설명이고, 기한·금액·제재 같은 법적 수치는 넣지 않았습니다.
 * 항목을 늘릴 때 법적 사실이 들어가면 반드시 공식 출처와 함께 guide 문서로 먼저 뽑으세요.
 */
import type { Audience } from './taxFacts';

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
  audience: Audience[];
  items: ChecklistItem[];
}

const HTS = 'https://www.hometax.go.kr';
const GOV24 = 'https://www.gov.kr';
const NTS = 'https://www.nts.go.kr';

export const CHECKLIST: ChecklistStage[] = [
  {
    id: 'pre',
    title: '1단계 · 개업 전',
    intro: '사업자등록을 하기 전까지 정리해 두면 뒤가 편해지는 항목들입니다.',
    audience: ['pre', 'sole'],
    items: [
      {
        id: 'pre-01',
        label: '사업자등록증에 넣을 업종(주업종·부업종)을 미리 적어뒀다',
        why: '업종은 이후 세율·허가·통계 기준으로 쓰입니다. 주업종을 잘못 고르면 인허가 안내가 어긋날 수 있습니다.',
        guide: '/guide/documents/business-registration/'
      },
      {
        id: 'pre-02',
        label: '사업장 주소와 임대차 계약을 확인했다',
        why: '사업자등록증 주소와 실제 사업장이 다르면 나중에 증빙·우편물 문제가 생깁니다.',
        link: { label: '정부24', url: GOV24 }
      },
      {
        id: 'pre-03',
        label: '업종별 인허가·신고가 필요한지 지자체·공식 안내로 확인했다',
        why: '식품·도소매·통신판매 등 업종에 따라 달라집니다.',
        link: { label: '정부24', url: GOV24 }
      },
      {
        id: 'pre-04',
        label: '사업자번호로 받을 결제수단(사업자 카드·계좌)을 준비했다',
        why: '개인 카드로 먼저 결제하면 증빙 종류가 카드매출전표로만 남게 됩니다.',
        guide: '/guide/receipts/regular-evidence/'
      },
      {
        id: 'pre-05',
        label: '거래처에 줄 사업자등록증 사본 견적·계약 파일을 만들었다',
        guide: '/guide/documents/business-documents/'
      }
    ]
  },
  {
    id: 'first-month',
    title: '2단계 · 첫 한 달',
    intro: '등록이 끝나고 실제 거래가 시작되는 시점의 정리 습관입니다.',
    audience: ['sole', 'corp'],
    items: [
      {
        id: 'm1-01',
        label: '지출을 카테고리 규칙으로 정했다 (예: 원가 / 판관리 / 일반관리)',
        guide: '/guide/receipts/monthly-close/'
      },
      {
        id: 'm1-02',
        label: '결제할 때 세금계산서·현금영수증·카드전표 중 무엇을 받을지 정했다',
        guide: '/guide/receipts/regular-evidence/'
      },
      {
        id: 'm1-03',
        label: '영수증 정리 도구에 첫 달 지출을 넣어보고 CSV 로 내보냈다',
        guide: '/tools/receipts/'
      },
      {
        id: 'm1-04',
        label: '증빙을 못 받은 거래 목록을 따로 모았다 (사후에 발급 요청)',
        guide: '/guide/receipts/missing-evidence/'
      },
      {
        id: 'm1-05',
        label: '직원·외주 지급 예정이 있으면 지급 형태(근로/사업소득)를 먼저 정리했다',
        link: { label: '국세청', url: NTS }
      },
      {
        id: 'm1-06',
        label: '고용이 시작되면 4대보험 어느 기관에 무엇을 신고하는지 확인했다',
        guide: '/guide/documents/business-documents/'
      }
    ]
  },
  {
    id: 'first-filing',
    title: '3단계 · 첫 신고 준비',
    intro: '신고 기간이 닥치면 순서가 정해져 있습니다. 아래는 순서이며, 기한 수치는 검증 후 표시됩니다.',
    audience: ['sole', 'corp'],
    items: [
      {
        id: 'f-01',
        label: '매출 자료(카드·현금영수증·세금계산서 발행분)를 홈택스에서 조회했다',
        link: { label: '홈택스', url: HTS }
      },
      {
        id: 'f-02',
        label: '매입 자료와 정리한 영수증 목록을 대조했다',
        guide: '/guide/receipts/monthly-close/'
      },
      {
        id: 'f-03',
        label: '증빙 종류별 합계를 뽑아 정규 증빙 비율을 확인했다',
        guide: '/tools/receipts/'
      },
      {
        id: 'f-04',
        label: '해당 신고 항목과 기한을 공식 안내에서 확인했다',
        guide: '/guide/tax/filing-calendar/',
        link: { label: '홈택스', url: HTS }
      },
      {
        id: 'f-05',
        label: '사업자 유형(일반과세자·간이과세자)에 맞는 신고 경로인지 확인했다',
        link: { label: '국세청', url: NTS }
      },
      {
        id: 'f-06',
        label: '최종 신고 전 세무사 또는 관할 세무서에서 확인받았다',
        why: '이 사이트는 일반 안내만 제공합니다. 금액·환급 판단은 전문가 확인이 필요합니다.'
      }
    ]
  }
];

export function allChecklistItemIds(stages: ChecklistStage[] = CHECKLIST): string[] {
  return stages.flatMap((s) => s.items.map((i) => i.id));
}

export function checklistProgress(done: Record<string, boolean>, stages: ChecklistStage[] = CHECKLIST): number {
  const ids = allChecklistItemIds(stages);
  if (ids.length === 0) return 0;
  const n = ids.filter((id) => done[id] === true).length;
  return Math.round((n / ids.length) * 100);
}
