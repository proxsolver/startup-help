# 모두의 창업 정산 도우미 (비공식)

지원사업(모두의 창업) **참여자**가 사업비를 집행하고 지출증빙을 모아 정산·보고하도록 돕는
정적 안내 사이트 + 브라우저 전용 집행 정리 도구.

> 이 사이트는 중소벤처기업부·창업진흥원의 공식 안내가 아닙니다. 공식 안내는 [modoo.or.kr](https://modoo.or.kr) 입니다.

- 배포: GitHub Pages (정적 파일, 서버 없음)
- 사용자 데이터: `window.localStorage` 에만 저장. 어떤 입력도 네트워크로 전송하지 않음
- 콘텐츠 원칙: **제출 시점·한도·인정 범위 같은 수치는 1차 출처 검증 전에는 게시하지 않는다**

## 구조

```
src/
  content/guides/{basics,expense,settlement,documents}/*.md   안내 문서 (frontmatter 스키마 검증)
  content.config.ts                                     Zod 스키마. sources 1개 이상 필수
  data/{checklists,schedule,categories}.ts              체크리스트·정산/제출 항목·분류 메타
  lib/{receipts,storage,url}.ts                         순수 로직 (단위 테스트 대상)
  components/                                           Header/Footer/Checklist/ReceiptTool/…
  layouts/Base.astro                                    공통 shell (라이트/다크, og, canonical)
  pages/                                                index, guide/, calendar/, tools/, 정보 페이지
  plugins/baseLinks.js                                  마크다운 루트 링크에 Pages base 경로 부착
scripts/check-content.mjs                               콘텐츠 게이트
tests/*.test.ts                                         vitest
```

## 정리 도구가 갖는 항목 (스키마 v2)

한 건 = `{ 지출일, 거래처, 금액, 비목(예산과목), 결제경로, 집행기간, 증빙종류, 수취상태, 제출상태, 메모 }`

| 축 | 값 | 왜 따로 두나 |
| --- | --- | --- |
| 결제경로 | 전용(체크)카드 · 사업자·법인카드 · 개인카드 · 현금 · 계좌이체 · 간편결제 · 기타 · 확인 필요 | 어느 경로로 결제했는지가 받을 수 있는 서류를 정합니다 |
| 집행기간 | 기간 내 · 기간 외 · 확인 필요 | 기간 밖 지출이 정산에서 가장 많이 잘립니다 |
| 증빙종류 | 세금계산서 · 계산서 · 현금영수증 · 카드전표(매출전표) · 간이영수증 · 계약서·견적서만 · 없음 | 세무 일반 용어이며 정산 인정 여부와는 별개입니다 |
| 수취상태 | 원본 확보 · 사본·이미지만 · 미수취 · 재요청함 | 정산은 파일로 받습니다. 종류만 알고 파일이 없으면 미수취와 같습니다 |
| 제출상태 | 미제출 · 초안 포함 · 제출 완료 · 보완 요청 | 보완 요구를 목록으로 되돌려 받아야 합니다 |

비목은 협약서의 예산과목 이름을 그대로 쓰도록 **자유 입력(예시 목록 제공)** 으로 두었습니다.
집계 화면은 총 집행액 / 전용카드 비율 / 수취구멍 / 기간 리스크 / 제출 전 합계를 나오고,
CSV 는 11열 대조표(`execution_*.csv`, UTF-8 BOM + CRLF)로 나갑니다.

**v1 데이터 호환**: 구버전 저장값(`category`, 결제수단 `카드`, `신용카드매출전표` 등)은
읽는 시점에 `sanitizeEntries → normalizeEntry` 에서 v2 로 승격됩니다. 판별은 v1 전용 필드
(`category` · `regularEvidence` · 결제수단 `카드`) 기준으로 하므로, v2 항목이 재승격으로 손상되지 않습니다.

## 실행

```bash
npm install
npm run dev            # http://localhost:4321 (base: /startup-help/)
ASTRO_LOCAL=1 npm run dev   # base 없이 루트로 (로컬 확인용)
npm test               # 정리 도구·저장 로직 단위 테스트
npm run check:content  # 출처/수치/링크/섞임 문자 게이트
npm run build          # dist/ 정적 출력
```

## 배포

`.github/workflows/deploy.yml` 이 push 시 `check:content` → `test` → `build` → Pages deploy 를 순서대로 실행합니다.
저장소 Settings → Pages → Source 를 **GitHub Actions** 로 두면 첫 deploy 가 붙습니다.

배포 경로가 `/startup-help/` 인 이유는 프로젝트 페이지이기 때문입니다. 커스텀 도메인을 쓰면
`astro.config.mjs` 의 `REPO`/`site`/`base` 를 고치세요. 콘텐츠 안의 링크는 `src/plugins/baseLinks.js` 가,
컴포넌트 안의 링크는 `src/lib/url.ts` 의 `p()` 가 자동으로 앞경로를 붙입니다.

## 검증 상태 모델 (핵심 설계)

문서·정산 항목마다 `verification: 'verified' | 'pending'` 을 가집니다.

| 상태 | 화면 동작 |
| --- | --- |
| `pending` | 문서 상단에 "출처 검증 대기" 배너. 시점·금액은 **빈칸** + 공식 창구 링크. 푸터에 대기 건수 표시 |
| `verified` | 배너 없음. 검증된 값과 출처가 본문·`sources` 에 존재 |

`pending` 문서가 `만원`/`억원`/`가산세`/`제N조`/보존기간·기한 수치를 쓰면 `npm run check:content` 가 빌드를 실패시킵니다.
같은 게이트가 한자·가나 섞임 문자도 전체 소스에서 잡아냅니다.
즉 "임의 수치를 올리지 않는다" 가 사람의 주의가 아니라 CI 규칙으로 강제됩니다.

## 초기 계획 대비 바꾼 것 (그리고 이유)

| 계획 | 실제 | 이유 |
| --- | --- | --- |
| 일반 창업 세무 안내 | **지원사업 참여자의 집행·증빙·정산**으로 축 이동 | 「모두의 창업」은 중기부·창업진흥원 사업 이름이고 이용자는 참여자였습니다. v0.1 은 도메인이 다른 안내였습니다 |
| Tailwind | 직접 작성한 `global.css` 하나 | 의존성·버전 변동 제거, 한글 개행(`word-break: keep-all`)·인쇄 스타일을 세밀히 통제 |
| Pagefind 검색 | 서버 렌더 목록 + 클라이언트 필터 | 페이지 수 대비 구성 비용이 크고 Pages base 경로 이슈가 적음 |
| Astro 콘텐츠 + MDX | MDX 없이 Markdown | 당분간 컴포넌트 삽입이 불필요 |
| 이름 「모두의 창업 도움」 | 「모두의 창업 정산 도우미 (비공식)」 | 공식 기관으로 오인될 수 있는 이름과 설명을 떼어냄 |

## 아직 안 한 것 / 다음

- **시점·기준 수치 채우기**: 제출 기한, 전용카드 사용 요구, 인정·불인정 범위, 서류 보존 기간, 인건비 서류 구성.
  공식 1차 출처(modoo.or.kr·창업진흥원·기업마당·담당 주관기관 공고) 검증 결과가 들어오는 대로 `src/data/schedule.ts` 와 문서에 반영
- **문서 서식(샘플 양식)**: 집행내역서·증빙 대응표·정산 요약 서식은 서식 기준 검증 후 추가
- 개인정보 처리방침의 법적 의무 범위 확인 (현재는 운영 사실 서술만)
- OCR·사진 인식 (서버 수신 없이 구현 가능한지 먼저 검토)
- 접근성·E2E 자동 테스트 (현재는 단위 테스트 + 콘텐츠 게이트만)
- 콘텐츠 증량 (현재 8건)

## 라이선스·면책

본 사이트의 안내는 일반 정보이며 세무·법률 자문이 아니고, 지원사업의 인정 여부를 판단하지 않습니다. `/disclaimer/` 참조.
