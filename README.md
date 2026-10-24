# 모두의 창업 도움

예비창업자·개업 직후 사업자를 위한 정적 안내 사이트 + 브라우저 전용 영수증 정리 도구.

- 배포: GitHub Pages (정적 파일, 서버 없음)
- 사용자 데이터: `window.localStorage` 에만 저장. 어떤 입력도 네트워크로 전송하지 않음
- 콘텐츠 원칙: **기한·한도·기준액 같은 법적 수치는 1차 출처 검증 전에는 게시하지 않는다**

## 구조

```
src/
  content/guides/{receipts,documents,tax,launch}/*.md   안내 문서 (frontmatter 스키마 검증)
  content.config.ts                                     Zod 스키마. sources 1개 이상 필수
  data/{checklists,taxFacts,categories}.ts              체크리스트·신고 항목·분류 메타
  lib/{receipts,storage,url}.ts                         순수 로직 (단위 테스트 대상)
  components/                                           Header/Footer/Checklist/ReceiptTool/…
  layouts/Base.astro                                    공통 shell (라이트/다크, og, canonical)
  pages/                                                index, guide/, calendar/, tools/, 정보 페이지
  plugins/baseLinks.js                                  마크다운 루트 링크에 Pages base 경로 부착
scripts/check-content.mjs                               콘텐츠 게이트
tests/*.test.ts                                         vitest
```

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

문서·신고 항목마다 `verification: 'verified' | 'pending'` 을 가집니다.

| 상태 | 화면 동작 |
| --- | --- |
| `pending` | 문서 상단에 "출처 검증 대기" 배너. 기한·금액은 **빈칸** + 공식 창구 링크. 푸터에 대기 건수 표시 |
| `verified` | 배너 없음. 검증된 값과 출처가 본문·`sources` 에 존재 |

`pending` 문서가 `만원`/`억원`/`가산세`/`제N조`/보존기간·기한 수치를 쓰면 `npm run check:content` 가 빌드를 실패시킵니다.
즉 "임의 수치를 올리지 않는다" 가 사람의 주의가 아니라 CI 규칙으로 강제됩니다.

## 초기 계획 대비 바꾼 것 (그리고 이유)

| 계획 | 실제 v0.1 | 이유 |
| --- | --- | --- |
| Tailwind | 직접 작성한 `global.css` 하나 | 의존성·버전 변동 제거, 한글 개행(`word-break: keep-all`)·인쇄 스타일을 세밀히 통제 |
| Pagefind 검색 | 서버 렌더 목록 + 클라이언트 필터 | 페이지 수 대비 구성 비용이 크고 Pages base 경로 이슈가 적음 |
| Astro 콘텐츠 + MDX | MDX 없이 Markdown | 당분간 컴포넌트 삽입이 불필요 |
| 단계 1~11 중 | 1,2,3,4(축소),5,6,7,8 + 정보 페이지 완료 | 배포·분석 연결(9), 대량 콘텐츠(10), 독립 리뷰(11) 는 다음 |

## 아직 안 한 것 / 다음

- **법적 수치 채우기**: 부가가치세·종합소득세·원천세 기한, 증빙 인정 한도, 보존기간, 간이과세 기준, 현금영수증 의무 발급 기준. 공식 1차 출처 검증 결과가 들어오는 대로 `src/data/taxFacts.ts` 와 문서에 반영
- 개인정보 처리방침의 법적 의무 범위 확인 (현재는 운영 사실 서술만)
- OCR·사진 인식 (서버 수신 없이 구현 가능한지 먼저 검토)
- 단위/종료일 기준의 세무 연동 내보내기 형식 (홈택스 업로드 양식 등)
- 접근성·E2E 자동 테스트 (현재는 단위 테스트 + 콘텐츠 게이트만)
- 콘텐츠 10~15건 증량, 노무 분류 추가

## 라이선스·면책

본 사이트의 안내는 일반 정보이며 세무·법률 자문이 아닙니다. `/disclaimer/` 참조.
