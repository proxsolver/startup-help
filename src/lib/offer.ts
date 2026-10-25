/**
 * 비즈니스 레이어(유료 도움 제안)의 판정 로직.
 *
 * 이 사이트의 철학은 "근거 없는 진술은 게시하지 않는다" 입니다. 유료 제안은 그 철학이 가장 쉽게
 * 깨지는 곳이라, 판정을 전부 순수 함수로 뽑아 테스트로 묶었습니다.
 *
 * 핵심 규칙 — **채워지지 않은 진술은 화면에 나오지 않습니다.**
 *  - `status` 가 `open` 이 아니고, 연락처가 없고, 항목에 `basis`(게시 근거) 가 없으면
 *    사이트는 상업 문구를 한 줄도 보여주지 않습니다. 기본값이 그 상태입니다.
 *  - 운영자의 가격·실적·회신 시간·자격은 제가 지어낼 수 없는 사실입니다. 그래서 필드를 열어두되
 *    빈 값이면 렌더링하지 않고, `check:content` 가 `open` 상태에서 빈 필드를 빌드 자체를 막습니다.
 *  - 세무대리와 서류 정리의 경계(`notFor`) 는 선택이 아니라 필수 필드입니다. 채우지 않으면 그 항목이 안 나옵니다.
 */

export type OfferStatus = 'preparing' | 'open';
export type OfferForm = 'online' | 'onsite' | 'either';

export interface OfferService {
  /** 화면·링크에 쓰는 key */
  id: string;
  /** 무엇을 해주는지 한 줄 */
  title: string;
  /** 어떤 동작인지 (방식·결과물) */
  desc: string;
  /** 이 항목으로 해결되지 않는 일. 세무 신고·세무조정처럼 자격이 묶인 일과 이 서비스로 못 하는 일을 적습니다. */
  notFor: string;
  /** 이 진술을 게시할 근거 (직접 한 일, 확인한 원문 등). 비면 표시하지 않습니다. */
  basis: string;
  /** 정해진 금액 문구. null 이면 "미정"이라는 말도 쓰지 않습니다. */
  price: string | null;
  form: OfferForm;
}

export interface OfferContact {
  kind: 'mailto' | 'link';
  /** 창구 이름 (예: 이메일·문의 링크) */
  label: string;
  /** mailto 주소 또는 https 링크 */
  value: string;
  /** 회신·상담 진행에 대한 진술. 근거 없으면 빈 문자열. */
  note: string;
  basis: string;
}

export interface OfferPrivacy {
  /** 문의 시 받는 항목. 빈 배열이면 "아무것도 받지 않습니다". */
  collects: string[];
  purpose: string;
  retention: string;
  /** 동의를 거부할 수 있다는 사실. 기관 안내가 목적·항목·보유 기간과 함께 고지하도록 적고 있습니다. */
  refusal: string;
  /** 처리 위탁(외부 폼·메일 사업자 등). 없으면 null. */
  processor: string | null;
  /** 제3자 제공(위탁이 아니라 남에게 넘기는 일). 없으면 null. 기관 안내는 위탁과 제3자 제공을 구분해 공개하라고 합니다. */
  thirdParty: string | null;
}

export interface Offer {
  status: OfferStatus;
  /** 운영자가 누구인지. 확인 가능한 문구만. */
  who: string;
  whoBasis: string;
  /** 어떤 상황에 도움을 주는지 (안 하는 일 포함). */
  scope: string;
  services: OfferService[];
  contact: OfferContact | null;
  privacy: OfferPrivacy | null;
}

/** 채워진 문구만 씁니다. 공백·들여쓰기만 있는 값은 없는 것으로 봅니다. 타입을 string 으로 좁혀 줍니다. */
function filled(v: string | null | undefined): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/** 게시 가능한 항목만 남깁니다. 근거·범위 경계가 없는 항목은 화면에서 사라집니다. */
export function publishableServices(offer: Offer): OfferService[] {
  return offer.services.filter((s) => filled(s.title) && filled(s.desc) && filled(s.basis) && filled(s.notFor));
}

/** 연락처 링크. `preparing` 이어도 값이 유효하면 링크는 만들 수 있습니다(게이트는 별도). */
export function contactHref(offer: Offer): string | null {
  const c = offer.contact;
  if (!c || !filled(c.value)) return null;
  const v = c.value.trim();
  if (c.kind === 'mailto') return /^mailto:/i.test(v) ? v : `mailto:${v}`;
  return /^https?:\/\//i.test(v) ? v : null;
}

/**
 * 유료 제안을 화면에 보여줄 상태인지. 세 조건이 다 맞아야 합니다.
 *  1) status 가 open
 *  2) 연락처가 유효
 *  3) 게시 가능한 항목이 1개 이상
 */
export function offerLive(offer: Offer): boolean {
  return offer.status === 'open' && contactHref(offer) !== null && publishableServices(offer).length > 0;
}

/** 화면에 올려도 되는 연락처 정보. `note` 는 근거가 없으면 버립니다. */
export function contactPresentation(offer: Offer): { label: string; note: string | null } {
  const c = offer.contact;
  if (!c) return { label: '문의 창구', note: null };
  return {
    label: filled(c.label) ? c.label.trim() : '문의 창구',
    note: filled(c.note) && filled(c.basis) ? c.note.trim() : null
  };
}

/** 운영자 소개 문구. 근거가 없으면 보여주지 않습니다. */
export function whoText(offer: Offer): string | null {
  return filled(offer.who) && filled(offer.whoBasis) ? offer.who.trim() : null;
}

/**
 * 가격 표시. 정해진 값이 없으면 "미정" 같은 대체 문구도 쓰지 않습니다 —
 * 값이 없다는 사실 자체가 방문자에게 불필요한 정보이고, 나중에 채울 때 실수로 남을 여지가 줄어듭니다.
 */
export function priceText(service: OfferService): string | null {
  return filled(service.price) ? service.price.trim() : null;
}

const FORM_LABEL: Record<OfferForm, string> = {
  online: '온라인',
  onsite: '만나서',
  either: '온라인·만나서 모두'
};

export function formLabel(form: OfferForm): string {
  return FORM_LABEL[form] ?? '형식 미정';
}

/**
 * 빌드 게이트가 쓰는 검증. `preparing` 은 항목이 비어 있어도 통과이고,
 * `open` 은 게시에 필요한 값을 다 요구합니다. 실패 문구는 사람이 고칠 수 있게 필드 이름을 적습니다.
 */
export function offerProblems(offer: Offer): string[] {
  const out: string[] = [];
  if (offer.status !== 'open') {
    // 준비 상태에서는 상업 문구를 아무것도 렌더링하지 않습니다. 연락처 값의 형식만 걸러 확인합니다.
    if (offer.contact && filled(offer.contact.value) && contactHref(offer) === null) {
      out.push('contact.value: mailto/link 종류와 맞지 않는 주소입니다');
    }
    return out;
  }
  if (!filled(offer.who)) out.push('who: 누구에게 무엇을 해주는지 적어야 합니다');
  if (!filled(offer.whoBasis)) out.push('whoBasis: 운영자 소개 문구의 근거가 없습니다');
  if (!filled(offer.scope)) out.push('scope: 도움 범위를 적어 주세요 (안 하는 일 포함)');
  if (!offer.contact || !filled(offer.contact.value)) out.push('contact.value: 문의 창구가 비어 있습니다');
  else if (contactHref(offer) === null) out.push('contact.value: 주소 형식이 종류와 맞지 않습니다');
  if (offer.contact && filled(offer.contact.note) && !filled(offer.contact.basis)) {
    out.push('contact.basis: 회신·진행 문구의 근거가 없어 표시되지 않습니다');
  }
  if (offer.services.length === 0) out.push('services: 제안 항목이 하나도 없습니다');
  offer.services.forEach((s, i) => {
    const at = `services[${i}]${filled(s.id) ? ` (${s.id})` : ''}`;
    if (!filled(s.title)) out.push(`${at}.title`);
    if (!filled(s.desc)) out.push(`${at}.desc`);
    if (!filled(s.notFor)) out.push(`${at}.notFor: 이 항목으로 해결되지 않는 일(범위 경계)은 필수입니다`);
    if (!filled(s.basis)) out.push(`${at}.basis: 게시 근거가 없는 항목은 화면에 나오지 않습니다`);
  });
  if (offer.services.length > 0 && publishableServices(offer).length === 0) {
    out.push('services: 게시 조건(제목·설명·경계·근거)을 통과한 항목이 없습니다');
  }
  if (offer.privacy) {
    if (!Array.isArray(offer.privacy.collects) || offer.privacy.collects.filter(filled).length === 0)
      out.push('privacy.collects: 문의 때 받는 항목을 하나 이상 적으세요 (빈 항목 고지는 성립하지 않습니다)');
    if (!filled(offer.privacy.purpose)) out.push('privacy.purpose: 수집·이용 목적이 비어 있습니다');
    if (!filled(offer.privacy.retention)) out.push('privacy.retention: 보유·이용 기간이 비어 있습니다');
    if (!filled(offer.privacy.refusal))
      out.push('privacy.refusal: 동의를 거부할 수 있다는 사실의 고지가 비어 있습니다 (목적·항목·보유 기간과 함께 고지 사항)');
  } else if (offer.contact && filled(offer.contact.value)) {
    out.push('privacy: 문의 창구를 열었으면 무엇을 받고 왜 받는지 적어야 합니다 (개인정보 처리 기준)');
  }
  return out;
}

/**
 * 개인정보 고지에 쓸 문구. 창구가 없으면 이 사이트는 아무것도 받지 않는다는 기존 진술이 그대로 맞습니다.
 */
export interface PrivacyNotice {
  collects: string[];
  purpose: string;
  retention: string;
  refusal: string;
  processor: string | null;
  thirdParty: string | null;
}

export function privacyStatement(offer: Offer): PrivacyNotice | null {
  const p = offer.privacy;
  if (!p) return null;
  return {
    collects: Array.isArray(p.collects) ? p.collects.filter(filled) : [],
    purpose: filled(p.purpose) ? p.purpose.trim() : '',
    retention: filled(p.retention) ? p.retention.trim() : '',
    refusal: filled(p.refusal) ? p.refusal.trim() : '',
    processor: filled(p.processor) ? p.processor : null,
    thirdParty: filled(p.thirdParty) ? p.thirdParty : null
  };
}
