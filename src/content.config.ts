import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * 검증 상태는 두 값만 허용합니다.
 *  - 'verified' : 1차 출처(국세청·홈택스·법제처·정부24 등)에서 확인하고 인용 출처를 적었다.
 *  - 'pending'  : 절차·방법 설명은 쓰되, 수치·기한·기준액 같은 법적 사실은 게시하지 않았다.
 *
 * 'pending' 문서가 법적 수치를 본문에 쓰면 안 되고, 화면에 확인 필요 배너가 뜹니다.
 */
const baseSchema = z.object({
  title: z.string(),
  summary: z.string(),
  category: z.enum(['basics', 'expense', 'settlement', 'documents']),
  /** 참여자 관점의 단계. 문서가 어느 시점의 이야기인지 나타냅니다. */
  audience: z
    .enum(['apply', 'execute', 'settle'])
    .array()
    .default(['execute']),
  tags: z.string().array().default([]),
  order: z.number().default(99),
  updatedAt: z.coerce.date(),
  verification: z.enum(['verified', 'pending']).default('pending'),
  verificationNote: z.string().optional(),
  sources: z
    .object({
      label: z.string(),
      url: z.string().url()
    })
    .array()
    .min(1, { message: '출처(공식 링크)가 1개 이상 필요합니다' })
});

const guides = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/guides' }),
  schema: baseSchema
});

export const collections = { guides };
