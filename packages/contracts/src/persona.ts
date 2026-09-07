import { z } from "zod";

const text = z.string().trim().min(1).max(5_000);
const texts = z.array(text).min(1).max(30);
const id = z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/).max(120);
export const BuyerRoleSchema = z.enum(["economic_buyer", "functional_buyer", "technical_buyer"]);

/** Private authored character material. Never part of the initial student bundle. */
export const PersonaProfileSchema = z.object({
  background: text,
  responsibilities: texts,
  workflow: texts,
  personalStakes: text,
  voice: text,
  knowledgeBoundary: text,
  disclosurePolicy: text,
  continuityPolicy: text,
  adoption: z.object({
    position: z.enum(["innovator", "early_adopter", "early_majority", "late_majority", "laggard"]),
    rationale: text,
    championStatus: text,
  }).strict(),
  relationships: z.array(z.object({ personaId: id, perspective: text }).strict()).max(30),
  jobs: z.array(z.object({
    id,
    situation: text,
    trigger: text,
    progress: text,
    functional: text,
    emotional: text,
    social: text,
    currentApproach: text,
    desiredOutcomes: texts,
    forces: z.object({ push: text, pull: text, anxiety: text, habit: text }).strict(),
  }).strict()).min(1).max(10),
  buyerRoles: z.array(z.object({
    role: BuyerRoleSchema,
    jobIds: z.array(id).min(1).max(10),
    authority: text,
    approvalConditions: texts,
    rejectionConditions: texts,
    importance: text,
    currentSatisfaction: text,
    alignmentTensions: texts,
  }).strict()).max(3),
  knowledge: z.array(z.object({
    factId: id,
    basis: z.enum(["firsthand", "record", "reported", "belief"]),
    confidenceAndLimits: text,
  }).strict()).min(1).max(100),
  episodes: z.array(z.object({
    id, situation: text, action: text, result: text,
    factIds: z.array(id).min(1).max(30),
  }).strict()).min(2).max(20),
  discoveryRoutes: z.object({
    background: z.array(id).min(1),
    job: z.array(id).min(1),
    change: z.array(id).min(1),
    episode: z.array(id).min(1),
    authority: z.array(id).min(1),
  }).strict(),
}).strict();
