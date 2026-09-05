import type { AuthoredRoute } from "@volta-sim/contracts";
import type { PublishedCase } from "./published-case.js";
import { verifyPublishedCase } from "./published-case.js";
import type { TrustedReleasedState } from "./trusted-state.js";
import { validateTrustedReleasedState } from "./trusted-state.js";

export const ROUTE_TIE_BREAK_POLICY = "reject-equal-highest-priority" as const;

export interface CaseRequest {
  readonly assignmentId: string;
  readonly attemptNumber: number;
  readonly channel: "persona" | "evidence" | "collection";
  readonly targetId: string;
  readonly question: string;
}

export type RouteResolution =
  | {
      readonly status: "matched";
      readonly routeId: string;
      readonly outcomeKind: AuthoredRoute["outcome"]["kind"];
      readonly studentMessage: string;
      readonly officialFacts: readonly PublishedFact[];
      readonly releasedEvidenceIds: readonly string[];
      readonly consequence: {
        readonly id: string;
        readonly time: { readonly amount: number; readonly unit: "minutes" | "hours" | "days" };
        readonly resources: readonly {
          readonly id: string;
          readonly amount: number;
          readonly unit: string;
        }[];
      };
      readonly collectionMethod?: string;
    }
  | {
      readonly status: "unavailable";
      readonly reason: "out-of-universe" | "prerequisite-not-met";
      readonly studentMessage: string;
      readonly officialFacts: readonly [];
      readonly releasedEvidenceIds: readonly [];
    }
  | {
      readonly status: "ambiguous";
      readonly reason: "equal-top-priority";
      readonly studentMessage: string;
      readonly officialFacts: readonly [];
      readonly releasedEvidenceIds: readonly [];
    };

function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

type PublishedRoute = PublishedCase["source"]["protected"]["routes"][number];
type PublishedFact = PublishedCase["source"]["protected"]["facts"][number];

function routeMatches(route: PublishedRoute, normalizedQuestion: string): boolean {
  const terms = new Set(normalizedQuestion.split(" ").filter(Boolean));
  const cueMatches = (cue: string): boolean => {
    const normalizedCue = normalizeText(cue);
    return normalizedCue.includes(" ")
      ? normalizedQuestion.includes(normalizedCue)
      : terms.has(normalizedCue);
  };
  const anyPhraseMatch =
    route.match.anyPhrases.length === 0 ||
    route.match.anyPhrases.some(cueMatches);
  const allTermsMatch = route.match.allTerms.every(cueMatches);
  const anyTermGroupMatch =
    route.match.anyTermGroups.length === 0 ||
    route.match.anyTermGroups.some((group) => group.every(cueMatches));
  const exclusionMatch = route.match.noneTerms.some(cueMatches);
  return anyPhraseMatch && allTermsMatch && anyTermGroupMatch && !exclusionMatch;
}

export function resolveAuthoredRequest(
  publishedInput: PublishedCase,
  request: CaseRequest,
  trustedState: TrustedReleasedState,
): RouteResolution {
  const publishedCase = verifyPublishedCase(publishedInput);
  if (
    request.assignmentId !== trustedState.assignmentId ||
    request.attemptNumber !== trustedState.attemptNumber
  ) {
    throw new Error("The request does not belong to the trusted assignment attempt");
  }
  const releasedFactIds = validateTrustedReleasedState(publishedCase, trustedState);
  const releasedEvidenceIds = new Set(
    trustedState.events.flatMap((event) => event.releasedEvidenceIds ?? []),
  );
  const source = publishedCase.source;
  const normalizedQuestion = normalizeText(request.question);
  const candidates = source.protected.routes
    .filter((route) => route.channel === request.channel && route.targetId === request.targetId)
    .filter((route) => routeMatches(route, normalizedQuestion));

  if (candidates.length === 0) {
    return {
      status: "unavailable",
      reason: "out-of-universe",
      studentMessage:
        source.protected.outOfUniverse?.studentMessage ??
        "That information is not available in this simulation.",
      officialFacts: [],
      releasedEvidenceIds: [],
    };
  }

  const released = new Set(releasedFactIds);
  const eligible = candidates.filter(
    (candidate) =>
      candidate.prerequisiteFactIds.every((factId) => released.has(factId)) &&
      candidate.prerequisiteEvidenceIds.every((evidenceId) => releasedEvidenceIds.has(evidenceId)),
  );
  if (eligible.length === 0) {
    return {
      status: "unavailable",
      reason: "prerequisite-not-met",
      studentMessage: "That information cannot be established from the evidence collected so far.",
      officialFacts: [],
      releasedEvidenceIds: [],
    };
  }

  const highestPriority = Math.max(...eligible.map(({ priority }) => priority));
  const highestPriorityRoutes = eligible.filter(({ priority }) => priority === highestPriority);
  if (highestPriorityRoutes.length > 1) {
    return {
      status: "ambiguous",
      reason: "equal-top-priority",
      studentMessage: "That request matches more than one authored route. Clarify the request.",
      officialFacts: [],
      releasedEvidenceIds: [],
    };
  }
  const route = highestPriorityRoutes[0]!;

  const factById = new Map(source.protected.facts.map((fact) => [fact.id, fact]));
  const officialFacts = route.outcome.factIds.map((factId) => {
    const fact = factById.get(factId);
    if (fact === undefined) throw new Error(`Published route references missing fact ${factId}`);
    return fact;
  });

  const base = {
    status: "matched" as const,
    routeId: route.id,
    outcomeKind: route.outcome.kind,
    studentMessage: route.outcome.studentMessage,
    officialFacts,
    releasedEvidenceIds: route.releasedEvidenceIds,
    consequence: {
      id: route.consequence.id,
      time: route.consequence.time,
      resources: route.consequence.resources,
    },
  };
  if (route.outcome.kind === "collection-plan") {
    return {
      ...base,
      collectionMethod: route.outcome.collectionMethod,
    };
  }
  return base;
}

export function factIdsEligibleForRelease(
  resolution: RouteResolution,
  providerSucceeded: boolean,
): readonly string[] {
  if (!providerSucceeded || resolution.status !== "matched") return [];
  return [...new Set(resolution.officialFacts.map(({ id }) => id))].sort();
}
