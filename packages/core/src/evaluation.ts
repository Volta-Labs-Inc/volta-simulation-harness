import type { HumanEvaluation, HumanRating } from "@volta-sim/contracts";

type CompetencyRatings = HumanEvaluation["competencies"];

export function deriveOverallHumanRating(competencies: CompetencyRatings): HumanRating {
  const ratings = Object.values(competencies).map(({ rating }) => rating);
  if (ratings.every((rating) => rating === "effective")) return "effective";
  if (ratings.every((rating) => rating === "not-yet-effective")) return "not-yet-effective";
  return "partially-effective";
}

export function validateHumanEvaluationConsistency(evaluation: HumanEvaluation): void {
  const expected = deriveOverallHumanRating(evaluation.competencies);
  if (evaluation.overallRating !== expected) {
    throw new Error(`Overall rating must be ${expected} for the four human competency judgments`);
  }
}
