import { z } from "zod";

export const HumanRatingSchema = z.enum([
  "effective",
  "partially-effective",
  "not-yet-effective",
]);

const CompetencyEvaluationSchema = z
  .object({
    rating: HumanRatingSchema,
    rationale: z.string().min(1).max(10_000),
  })
  .strict();

export const HumanEvaluationSchema = z
  .object({
    evaluationId: z.string().min(1).max(160),
    submissionId: z.string().min(1).max(160),
    evaluatorGithubUserId: z.string().regex(/^\d+$/),
    evaluatedAt: z.string().datetime({ offset: true }),
    competencies: z
      .object({
        "problem-viability": CompetencyEvaluationSchema,
        "evidence-sufficiency": CompetencyEvaluationSchema,
        "response-feasibility": CompetencyEvaluationSchema,
        "objective-success-criteria": CompetencyEvaluationSchema,
      })
      .strict(),
    overallRating: HumanRatingSchema,
    overallRationale: z.string().min(1).max(10_000),
  })
  .strict();

export type HumanRating = z.infer<typeof HumanRatingSchema>;
export type HumanEvaluation = z.infer<typeof HumanEvaluationSchema>;
