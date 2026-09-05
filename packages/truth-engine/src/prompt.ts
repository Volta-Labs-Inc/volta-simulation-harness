import { createHash } from "node:crypto";
import {
  resolveAuthoredRequest,
  type CaseRequest,
  type RouteResolution,
  type TrustedReleasedState,
} from "@volta-sim/core";
import type {
  AuthoritativeFactView,
  ConsequenceOutcomeClass,
  ProviderPromptPackage,
  ResourceEffect,
  ReviewGuidance,
  TimeEffect,
} from "./types.js";

type PublishedCase = Parameters<typeof resolveAuthoredRequest>[0];
type PublishedRoute = PublishedCase["source"]["protected"]["routes"][number];

export interface PreparedActionPlan {
  readonly resolution: Extract<RouteResolution, { readonly status: "matched" }>;
  readonly route: PublishedRoute;
  readonly outcomeClass: ConsequenceOutcomeClass;
  readonly prompt: ProviderPromptPackage;
  readonly promptPackageDigest: `sha256:${string}`;
  readonly authoritativeFacts: readonly AuthoritativeFactView[];
  readonly releasedEvidenceIds: readonly string[];
  readonly time: TimeEffect;
  readonly resources: readonly ResourceEffect[];
  readonly reviewGuidance?: Omit<ReviewGuidance, "requested">;
}

export type PreparedResolution =
  | { readonly status: "ready"; readonly plan: PreparedActionPlan }
  | {
      readonly status: "unavailable" | "ambiguous";
      readonly reason:
        | "out-of-universe"
        | "prerequisite-not-met"
        | "equal-top-priority";
      readonly studentMessage: string;
    };

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function outcomeClassFor(
  publishedCase: PublishedCase,
  request: CaseRequest,
  route: PublishedRoute,
): ConsequenceOutcomeClass {
  const behaviors = publishedCase.source.protected.evidenceBehaviors ?? [];
  const relevant = behaviors.filter((behavior) => {
    if (request.channel === "evidence") return behavior.evidenceSourceId === request.targetId;
    if (request.channel === "collection") {
      return (
        behavior.collectionRouteId === route.id ||
        route.releasedEvidenceIds.includes(behavior.evidenceSourceId)
      );
    }
    return false;
  });
  const authoredClasses = [...new Set(relevant.map(({ outcomeClass }) => outcomeClass))];
  if (authoredClasses.length > 1) {
    throw new Error("A route cannot resolve to conflicting authored consequence classes");
  }
  const authored = authoredClasses[0];
  if (authored !== undefined) return authored;
  if (route.outcome.kind === "unavailable") return "unavailable";
  if (route.outcome.kind === "partial" || route.outcome.kind === "collection-plan") {
    return "partial";
  }
  return "complete";
}

function responsePointsFor(
  publishedCase: PublishedCase,
  request: CaseRequest,
  route: PublishedRoute,
): ProviderPromptPackage["responsePoints"] {
  const points: { id: string; text: string }[] = [
    { id: "student-message", text: route.outcome.studentMessage },
  ];
  if (route.outcome.kind === "partial") {
    points.push({ id: "route-limitation", text: route.outcome.limitation });
  }
  if (route.outcome.kind === "collection-plan") {
    points.push({ id: "collection-method", text: route.outcome.collectionMethod });
  }

  const behaviors = publishedCase.source.protected.evidenceBehaviors ?? [];
  const relevant = behaviors.filter((behavior) => {
    if (request.channel === "evidence") return behavior.evidenceSourceId === request.targetId;
    if (request.channel === "collection") {
      return (
        behavior.collectionRouteId === route.id ||
        route.releasedEvidenceIds.includes(behavior.evidenceSourceId)
      );
    }
    return false;
  });
  for (const behavior of relevant) {
    behavior.limitations.forEach((text, index) => {
      points.push({ id: `${behavior.evidenceSourceId}-limitation-${index + 1}`, text });
    });
    if (behavior.studentVisibleSamplingFrame !== undefined) {
      points.push({
        id: `${behavior.evidenceSourceId}-sampling-included`,
        text: behavior.studentVisibleSamplingFrame.included,
      });
      points.push({
        id: `${behavior.evidenceSourceId}-sampling-excluded`,
        text: behavior.studentVisibleSamplingFrame.excluded,
      });
    }
  }
  const ids = points.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Prompt-local response point identifiers must be unique");
  }
  return points;
}

function personaFor(
  publishedCase: PublishedCase,
  request: CaseRequest,
): ProviderPromptPackage["persona"] {
  if (request.channel !== "persona") return undefined;
  const persona = publishedCase.source.visible.personas.find(({ id }) => id === request.targetId);
  const behavior = publishedCase.source.protected.personaBehaviors.find(
    ({ personaId }) => personaId === request.targetId,
  );
  if (persona === undefined || behavior === undefined) {
    throw new Error("The selected persona needs one visible profile and one behavior profile");
  }
  return {
    id: persona.id,
    name: persona.name,
    role: persona.role,
    studentBrief: persona.studentBrief,
    incentives: [...behavior.incentives],
    uncertainties: [...behavior.uncertainties],
    biases: [...(behavior.biases ?? [])],
    refusalBoundaries: behavior.refusalRules.map(({ responseBoundary }) => responseBoundary),
  };
}

function promptForSelectedRoute(
  publishedCase: PublishedCase,
  request: CaseRequest,
  route: PublishedRoute,
  facts: readonly { readonly id: string; readonly claim: string }[],
): ProviderPromptPackage {
  const selectedPersona = personaFor(publishedCase, request);
  return {
    schemaVersion: "1",
    interaction: {
      channel: request.channel,
      targetId: request.targetId,
      studentText: request.question,
    },
    ...(selectedPersona === undefined ? {} : { persona: selectedPersona }),
    officialFacts: facts.map(({ id, claim }) => ({ id, claim })),
    responsePoints: responsePointsFor(publishedCase, request, route),
  };
}

export function prepareAction(
  publishedCase: PublishedCase,
  request: CaseRequest,
  state: TrustedReleasedState,
): PreparedResolution {
  const resolution = resolveAuthoredRequest(publishedCase, request, state);
  if (resolution.status !== "matched") {
    return {
      status: resolution.status,
      reason: resolution.reason,
      studentMessage: resolution.studentMessage,
    };
  }
  const route = publishedCase.source.protected.routes.find(({ id }) => id === resolution.routeId);
  if (route === undefined) throw new Error("The resolved route no longer exists in the case version");

  const prompt = promptForSelectedRoute(publishedCase, request, route, resolution.officialFacts);
  const risk = route.consequence.risk;
  return {
    status: "ready",
    plan: {
      resolution,
      route,
      outcomeClass: outcomeClassFor(publishedCase, request, route),
      prompt,
      promptPackageDigest: digest(prompt),
      authoritativeFacts: resolution.officialFacts.map(({ id, claim, provenance }) => ({
        id,
        claim,
        provenance,
      })),
      releasedEvidenceIds: [...new Set(resolution.releasedEvidenceIds)].sort(),
      time: resolution.consequence.time,
      resources: resolution.consequence.resources,
      ...(risk === undefined
        ? {}
        : {
            reviewGuidance: {
              level: risk.level,
              suggested: risk.suggestStaffReview,
              blocksSandboxWork: risk.blocksSandboxWork,
            },
          }),
    },
  };
}

export function prepareReplayPrompt(
  publishedCase: PublishedCase,
  input: {
    readonly routeId: string;
    readonly request: CaseRequest;
    readonly authoritativeFacts: readonly AuthoritativeFactView[];
    readonly releasedEvidenceIds: readonly string[];
    readonly expectedPromptPackageDigest: string;
  },
): { readonly prompt: ProviderPromptPackage; readonly digest: `sha256:${string}` } {
  const route = publishedCase.source.protected.routes.find(({ id }) => id === input.routeId);
  if (route === undefined) throw new Error("Replay route is absent from the frozen case version");
  const routeFactIds = [...new Set(route.outcome.factIds)].sort();
  const originalFactIds = [...new Set(input.authoritativeFacts.map(({ id }) => id))].sort();
  const routeEvidenceIds = [...new Set(route.releasedEvidenceIds)].sort();
  if (
    JSON.stringify(routeFactIds) !== JSON.stringify(originalFactIds) ||
    JSON.stringify(routeEvidenceIds) !== JSON.stringify(input.releasedEvidenceIds)
  ) {
    throw new Error("Replay truth no longer matches the original frozen route");
  }
  const factsById = new Map(publishedCase.source.protected.facts.map((fact) => [fact.id, fact]));
  const exactFacts = originalFactIds.map((id) => {
    const fact = factsById.get(id);
    if (fact === undefined) throw new Error("Replay references a fact absent from the case version");
    return fact;
  });
  const prompt = promptForSelectedRoute(publishedCase, input.request, route, exactFacts);
  const replayDigest = digest(prompt);
  if (replayDigest !== input.expectedPromptPackageDigest) {
    throw new Error("Replay prompt does not match the original prompt package digest");
  }
  return { prompt, digest: replayDigest };
}

export function promptPackageDigest(prompt: ProviderPromptPackage): `sha256:${string}` {
  return digest(prompt);
}
