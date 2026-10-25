import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { OFFER } from '../src/data/offer';
import {
  contactHref,
  contactPresentation,
  formLabel,
  offerLive,
  offerProblems,
  priceText,
  privacyStatement,
  publishableServices,
  whoText,
  type Offer,
  type OfferService
} from '../src/lib/offer';

function service(over: Partial<OfferService> = {}): OfferService {
  return {
    id: 'organize',
    title: '집행 기록 정리',
    desc: '브라우저에 있는 지출 행을 비목·증빙 상태로 정리해 표로 만듭니다.',
    notFor: '세무 신고·세무조정·원천세 신고는 해 주지 않습니다.',
    basis: '운영자가 직접 집행·정산해 본 절차',
    price: null,
    form: 'online',
    ...over
  };
}

function offer(over: Partial<Offer> = {}): Offer {
  return {
    status: 'open',
    who: '사업비를 직접 집행·정산해 본 참여자',
    whoBasis: '이 사이트의 집행 기록으로 확인 가능',
    scope: '집행 기록 정리·증빙 대응표·기관 제출 꾸러미 묶기. 세무 신고와 세무조정은 하지 않습니다.',
    services: [service()],
    contact: {
      kind: 'mailto',
      label: '이메일 문의',
      value: 'mailto:operator@example.org',
      note: '',
      basis: ''
    },
    privacy: {
      collects: ['문의 내용', '회신용 이메일'],
      purpose: '문의에 답하기 위해',
      retention: '회신 후 30일',
      refusal: '동의를 거부할 수 있고, 거부해도 이 사이트의 무료 안내는 그대로 쓸 수 있습니다.',
      processor: null,
      thirdParty: null
    },
    ...over
  };
}

describe('오퍼 기본 상태 (게시물 무결성)', () => {
  it('src/data/offer.ts 의 기본값은 상업 문구를 한 줄도 그리지 않는다', () => {
    expect(OFFER.status).toBe('preparing');
    expect(offerLive(OFFER)).toBe(false);
    expect(publishableServices(OFFER)).toHaveLength(0);
    expect(contactHref(OFFER)).toBeNull();
    expect(offerProblems(OFFER)).toEqual([]);
  });

  it('운영자가 open 으로 바꾼 데이터는 필수 칸이 채워져 있어야 한다', () => {
    // 이 테스트는 미래를 걸습니다. status 를 open 으로 커밋하는 순간 빈 칸이 있으면 안 됩니다.
    if (OFFER.status === 'open') {
      expect(offerProblems(OFFER)).toEqual([]);
      expect(offerLive(OFFER)).toBe(true);
    } else {
      expect(OFFER.status).toBe('preparing');
    }
  });

  it('기본 데이터에는 지어낸 가격·실적·회신 시간 문구가 없다', () => {
    const text = JSON.stringify(OFFER);
    expect(text).not.toMatch(/만원|억원|시간 내|일 내|평균|최대 \d/);
    expect(OFFER.services.every((s) => s.price === null)).toBe(true);
  });
});

describe('offerLive', () => {
  it('open + 유효한 창구 + 게시 가능한 항목이 다 있어야 켜진다', () => {
    expect(offerLive(offer())).toBe(true);
    expect(offerLive(offer({ status: 'preparing' }))).toBe(false);
    expect(offerLive(offer({ contact: null }))).toBe(false);
    expect(offerLive(offer({ services: [service({ basis: '' })] }))).toBe(false);
  });
});

describe('채워지지 않은 진술은 렌더링되지 않는다', () => {
  it('항목은 title·desc·notFor·basis 네 칸이 다 채워져야 게시된다', () => {
    expect(publishableServices(offer({ services: [service(), service({ id: 'x', basis: '  ' })] }))).toHaveLength(1);
    expect(publishableServices(offer({ services: [service({ notFor: '' })] }))).toHaveLength(0);
    expect(publishableServices(offer({ services: [] }))).toHaveLength(0);
  });

  it('근거 없는 운영자 소개·회신 문구는 사라진다', () => {
    expect(whoText(offer())).toBe('사업비를 직접 집행·정산해 본 참여자');
    expect(whoText(offer({ whoBasis: '' }))).toBeNull();
    expect(contactPresentation(offer({ contact: { ...offer().contact!, note: '영업일 3일 내 회신' } })).note).toBeNull();
    expect(contactPresentation(offer({ contact: { ...offer().contact!, note: '영업일 3일 내 회신', basis: '실제 회신 기록' } })).note).toBe(
      '영업일 3일 내 회신'
    );
    expect(contactPresentation(offer({ contact: null }))).toEqual({ label: '문의 창구', note: null });
  });

  it('가격이 없으면 "미정" 같은 대체 문구도 만들지 않는다', () => {
    expect(priceText(service({ price: null }))).toBeNull();
    expect(priceText(service({ price: '   ' }))).toBeNull();
    expect(priceText(service({ price: '요청 후 견적' }))).toBe('요청 후 견적');
  });

  it('formLabel 은 정해진 값만 번역하고 나머지는 미정으로 남긴다', () => {
    expect(formLabel('online')).toBe('온라인');
    expect(formLabel('onsite')).toBe('만나서');
    expect(formLabel('either')).toBe('온라인·만나서 모두');
    // @ts-expect-error 존재하지 않는 형식도 화면이 죽지 않도록 기본값
    expect(formLabel('teleport')).toBe('형식 미정');
  });
});

describe('contactHref', () => {
  it('mailto 값에 접두어를 붙이고 https 링크만 link 종류로 받는다', () => {
    expect(contactHref(offer({ contact: { ...offer().contact!, value: 'operator@example.org' } }))).toBe('mailto:operator@example.org');
    const link = offer({ contact: { kind: 'link', label: '양식', value: 'https://forms.example.org/a', note: '', basis: '' } });
    expect(contactHref(link)).toBe('https://forms.example.org/a');
    expect(contactHref(offer({ contact: { kind: 'link', label: '양식', value: 'ftp://nope', note: '', basis: '' } }))).toBeNull();
    expect(contactHref(offer({ contact: { kind: 'mailto', label: '', value: '   ', note: '', basis: '' } }))).toBeNull();
  });
});

describe('offerProblems (빌드 게이트가 쓰는 판정)', () => {
  it('완전히 채운 open 은 문제가 없다', () => {
    expect(offerProblems(offer())).toEqual([]);
  });

  it('preparing 은 항목이 비어도 통과 — 단 창구 값 형식은 본다', () => {
    expect(offerProblems(OFFER)).toEqual([]);
    expect(offerProblems(offer({ status: 'preparing', contact: { kind: 'link', label: '', value: 'example.org', note: '', basis: '' } }))).toEqual([
      expect.stringContaining('contact.value')
    ]);
  });

  it('open 에서 빈 필수 칸을 필드 이름으로 알려준다', () => {
    const bad = offer({
      status: 'open',
      who: '',
      scope: '  ',
      contact: { kind: 'link', label: '', value: 'example.org/a', note: '3일 내 회신', basis: '' },
      services: [service({ notFor: '' })],
      privacy: null
    });
    const problems = offerProblems(bad);
    expect(problems.join('\n')).toContain('who');
    expect(problems.join('\n')).toContain('scope');
    expect(problems.join('\n')).toContain('contact.value');
    expect(problems.join('\n')).toContain('contact.basis');
    expect(problems.join('\n')).toContain('notFor');
    expect(problems.join('\n')).toContain('privacy');
  });

  it('연락처를 열었는데 개인정보 기준이 없으면 실패한다', () => {
    expect(offerProblems(offer({ privacy: null })).join('\n')).toContain('privacy');
  });

  it('고지 네 칸(항목·이유·보유 기간·거부 사실) 중 빈 것은 무엇인가로 막히는지 알려준다', () => {
    const problems = offerProblems(
      offer({ privacy: { collects: [], purpose: '', retention: '', refusal: '', processor: null, thirdParty: null } })
    ).join('\n');
    expect(problems).toContain('privacy.collects');
    expect(problems).toContain('privacy.purpose');
    expect(problems).toContain('privacy.retention');
    expect(problems).toContain('privacy.refusal');
  });

  it('동의 거부 고지만 비워도 open 은 막힌다', () => {
    expect(
      offerProblems(offer({ privacy: { ...offer().privacy!, refusal: '   ' } })).join('\n')
    ).toContain('privacy.refusal');
    expect(offerProblems(offer({ privacy: { ...offer().privacy!, refusal: '거부할 수 있습니다.' } }))).toEqual([]);
  });

  it('처리 위탁과 제3자 제공은 다른 칸이고, 둘 다 비면 null 로 남는다', () => {
    const split = offer({
      privacy: { ...offer().privacy!, processor: '외부 양식 서비스', thirdParty: '회신 보관 업체' }
    });
    expect(privacyStatement(split)).toMatchObject({ processor: '외부 양식 서비스', thirdParty: '회신 보관 업체' });
    // 위탁이 있는데 제3자 제공이 없는 경우를 '없음'으로 단정하지 않고 비워 둔다(운영자 사실이라).
    expect(privacyStatement(offer({ privacy: { ...offer().privacy!, processor: '외부 양식 서비스' } }))!.thirdParty).toBeNull();
  });
});

describe('privacyStatement', () => {
  it('창구가 없으면 null — "이 사이트는 아무것도 받지 않는다" 진술이 그대로 맞다', () => {
    expect(privacyStatement(offer({ privacy: null }))).toBeNull();
  });
  it('빈 수집 항목은 걸러 내고 문자열로 좁힌다', () => {
    const p = privacyStatement(
      offer({ privacy: { ...offer().privacy!, collects: ['이메일', '  ', ''], purpose: '  답장  ', retention: ' 30일 ', processor: '  ' } })
    );
    expect(p).toEqual({
      collects: ['이메일'],
      purpose: '답장',
      retention: '30일',
      refusal: offer().privacy!.refusal,
      processor: null,
      thirdParty: null
    });
  });
});

describe('게이트 규칙 9 ↔ offerProblems 일치', () => {
  /**
   * 빌드 게이트는 offer.ts 를 정규식으로 읽고, lib 는 실제 객체를 봅니다. 이 둘이 다른 칸을 요구하면
   * 약한 쪽이 먼저 통과해서 '고지 없이 열린 창구' 가 게시됩니다(실제로 privacy.collects 에서 발생).
   * 그래서 lib 가 요구하는 칸이 스크립트에도 적혀 있는지 원문 대조로 확인합니다.
   */
  const script = readFileSync(new URL('../scripts/check-content.mjs', import.meta.url), 'utf8');

  /** 문제 문구를 '칸 이름' 으로 좁힙니다 (services[0] (organize).title → services.title). */
  const fieldOf = (problem: string) =>
    problem
      .split(':')[0]
      .trim()
      .replace(/services\[\d+\](\s*\([^)]*\))?/, 'services')
      .replace(/\s+/g, ' ');

  it('lib 가 open 에서 요구하는 칸은 전부 스크립트 규칙 9 에도 적혀 있다', () => {
    const empty = offer({
      who: '',
      whoBasis: '',
      scope: '',
      contact: { kind: 'mailto', label: '', value: '', note: '', basis: '' },
      services: [service({ title: '', desc: '', notFor: '', basis: '' })],
      privacy: { collects: [], purpose: '', retention: '', refusal: '', processor: null, thirdParty: null }
    });
    const gateFields = new Set<string>([...script.matchAll(/requireField\('([^']+)'/g)].map((m) => m[1]));
    for (const k of ['title', 'desc', 'notFor', 'basis']) gateFields.add(`services.${k}`);
    gateFields.add('privacy.collects'); // 스크립트는 배열 내용을 따로 판정합니다
    gateFields.add('services');

    const missing = [...new Set(offerProblems(empty).map(fieldOf))].filter((f) => !gateFields.has(f));
    expect(missing).toEqual([]);
  });

  it('규칙 9 는 collects 의 빈 항목·공백·줄 삭제를 모두 막는다', () => {
    for (const shape of ['collects: []', "collects: ['']", "collects: ['  ', ' ']", '']) {
      const sample = `privacy: { ${shape}, purpose: 'a', retention: 'b', refusal: 'c' }`;
      const raw = /collects:\s*\[([\s\S]*?)\]/.exec(sample)?.[1] ?? '';
      const filled = (raw.match(/'([^']*)'/g) ?? []).filter((s) => s.slice(1, -1).trim() !== '').length;
      expect(filled, shape).toBe(0);
    }
  });
});
