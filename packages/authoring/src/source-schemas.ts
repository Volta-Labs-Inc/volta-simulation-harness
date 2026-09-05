import { z } from "zod";

const IdSchema = z.string().min(1).max(160);
const TextSchema = z.string().min(1).max(20_000);

export const CaseFileSchema = z
  .object({
    schema_version: z.string(),
    assembly_ref: z.string(),
    route_validation_ref: z.string(),
    validation_record_ref: z.string(),
    case_id: IdSchema,
    version: z.string().min(1).max(80),
    status: z.enum(["draft", "approved"]),
    assessment_use: z.enum(["assessed", "non-assessed-example"]).optional(),
    title: TextSchema,
    student_title: TextSchema,
    experience_level: z.enum(["introductory", "intermediate", "advanced"]),
    difficulty: z
      .object({ level: z.string(), deliberate_factors: z.array(TextSchema).min(1).max(20) })
      .strict(),
    time_limit: z.null(),
    student_facing_budget_limit: z.null(),
    mode: z.literal("text_only"),
    origin: z
      .object({ disclosure_to_student: z.literal("simulated"), private_metadata_ref: z.string() })
      .strict(),
    methodology_snapshot: z
      .object({ student_ref: z.string(), requirements_ref: z.string(), private_source_ref: z.string() })
      .strict(),
    competencies: z
      .array(
        z
          .object({
            id: IdSchema,
            label: TextSchema,
            required_for_overall_effective: z.literal(true),
          })
          .strict(),
      )
      .length(4),
    visible_bundle: z
      .object({
        brief: z.string(),
        rubric: z.string(),
        requirements: z.string(),
        initial_evidence: z.array(IdSchema),
      })
      .strict(),
    personas_ref: z.string(),
    truth_ref: z.string(),
    evidence_catalog_ref: z.string(),
    collection_consequences_ref: z.string(),
    economics_ref: z.string(),
    evaluation_anchors_ref: z.string(),
    boundaries_ref: z.string(),
    calibrations: z.array(z.string()).length(3),
    reference_import_fixture: z.string(),
    assignment_defaults: z.record(z.unknown()),
    first_pilot: z.record(z.unknown()),
    out_of_universe: z
      .object({
        result: z.literal("unavailable"),
        message: TextSchema,
        releases_fact_ids: z.array(IdSchema).length(0),
      })
      .strict(),
    publication: z
      .object({
        generated_outputs_frozen: z.literal(true),
        visible_bundle_sha256: z.string(),
        protected_package_sha256: z.string(),
        approval_required_after_material_change: z.literal(true),
        approved_by: z.string().min(1).max(200).nullable(),
        approved_at: z.string().datetime({ offset: true }).nullable(),
      })
      .strict(),
  })
  .strict();

export const RequirementsFileSchema = z
  .object({
    snapshot_id: IdSchema,
    source_catalog_count: z.number().int().positive(),
    selection_rule: TextSchema,
    student_states: z
      .object({
        allowed: z.array(z.enum(["open", "present", "not_applicable"])).min(1),
        not_applicable_requires_rationale: z.literal(true),
        quality_judgment_visible_during_attempt: z.literal(false),
      })
      .strict(),
    requirements: z
      .array(
        z
          .object({
            key: IdSchema,
            label: TextSchema,
            stage: IdSchema,
            gate: IdSchema.optional(),
            optional: z.boolean().optional(),
            initial_state: z.enum(["open", "present"]),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    excluded_as_not_case_applicable: z
      .array(z.object({ reason: TextSchema, keys: z.array(IdSchema).min(1) }).strict())
      .max(100),
  })
  .strict();

const CanonicalPersonaMatchSchema = z
  .object({ any_of: z.array(IdSchema).min(1), none_of: z.array(IdSchema) })
  .strict();

export const PersonasFileSchema = z
  .object({
    schema_version: z.string(),
    grounding_rule: TextSchema,
    fallback_rule: TextSchema,
    route_resolution: z.record(z.unknown()),
    personas: z
      .array(
        z
          .object({
            id: IdSchema,
            display_name: TextSchema,
            title: TextSchema,
            roles: z.array(IdSchema).min(1),
            incentives: z.array(TextSchema).min(1),
            biases: z.array(TextSchema).min(1),
            opening: z
              .object({ releases: z.array(IdSchema), points: z.array(TextSchema).min(1) })
              .strict(),
            routes: z
              .array(
                z
                  .object({
                    id: IdSchema,
                    priority: z.number().int(),
                    canonical_match: CanonicalPersonaMatchSchema,
                    releases: z.array(IdSchema).min(1),
                    response_points: z.array(TextSchema).min(1),
                  })
                  .strict(),
              )
              .min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export const TruthFileSchema = z
  .object({
    case_id: IdSchema,
    company: z
      .object({
        legal_name: TextSchema,
        fictional: z.literal(true),
        headquarters: TextSchema,
        annual_revenue_cad: z.number().finite().nonnegative(),
        employees: z.number().int().positive(),
        support_staff: z.number().int().positive(),
        support_hours: TextSchema,
        gross_margin_percent: z.number().min(0).max(100),
      })
      .strict(),
    problem_truth: z
      .object({
        summary: TextSchema,
        recurring: z.boolean(),
        materiality: TextSchema,
        causal_factors: z.array(TextSchema).min(1),
        false_shortcut: TextSchema,
        unresolved_at_start: z.array(TextSchema).min(1),
      })
      .strict(),
    stakeholder_truth: z
      .object({
        champion: IdSchema,
        economic_buyer: IdSchema,
        functional_buyer: IdSchema,
        technical_buyer: IdSchema,
        frontline_representative: IdSchema,
        finance_evidence_owner: IdSchema,
      })
      .strict(),
    fixed_constraints: z
      .object({
        holiday_catalogue_launch: z.union([z.string(), z.date()]),
        decision_checkpoint: z.union([z.string(), z.date()]),
        discovery_and_sandbox_budget_ceiling_cad: z.number().finite().nonnegative(),
        champion_time_hours_per_week: z.number().finite().nonnegative(),
        support_manager_time_hours_per_week: z.number().finite().nonnegative(),
        it_time_hours_total: z.number().finite().nonnegative(),
        public_deployment_authorized: z.boolean(),
        production_credentials_available: z.boolean(),
        external_customer_contact_authorized: z.boolean(),
        staff_reduction_allowed: z.boolean(),
        customer_pii_export_to_unapproved_provider: z.boolean(),
        privacy_and_chargeback_routes_require_human_review: z.boolean(),
      })
      .strict(),
    available_solution_capabilities: z
      .object({
        existing_platform: z
          .object({
            rule_routing_included: z.boolean(),
            structured_form_fields_included: z.boolean(),
            sandbox_available: z.boolean(),
            shadow_mode_supported: z.boolean(),
            api_export_supported: z.boolean(),
          })
          .strict(),
        approved_local_work: z.array(TextSchema).min(1),
      })
      .strict(),
  })
  .strict();

const EvidenceEntrySchema = z
  .object({
    id: IdSchema,
    title: TextSchema,
    availability: z.enum(["initial", "on_purposeful_request", "after_collection", "unavailable"]),
    request_intents: z.array(TextSchema).optional(),
    collection_route: IdSchema.optional(),
    path: z.string().nullable(),
    provenance: TextSchema.optional(),
    outcome_class: z.enum(["complete", "partial", "biased", "unavailable", "unusable"]),
    releases: z.array(IdSchema),
    limitations: z.array(TextSchema).optional(),
    reason: TextSchema.optional(),
    student_visible_sampling_frame: z
      .object({ included: TextSchema, excluded: TextSchema })
      .strict()
      .optional(),
  })
  .strict();

export const EvidenceFileSchema = z
  .object({
    schema_version: z.string(),
    authoritative_rule: TextSchema,
    entries: z.array(EvidenceEntrySchema).min(1).max(100),
    fact_index: z.record(IdSchema, TextSchema),
  })
  .strict();

const CollectionMatchSchema = z
  .object({
    all_of: z.array(IdSchema),
    any_groups: z.array(z.array(IdSchema).min(1)),
    none_of: z.array(IdSchema),
  })
  .strict();

export const CollectionFileSchema = z
  .object({
    schema_version: z.string(),
    clock_start: z.union([z.string(), z.date()]),
    route_resolution: z.record(z.unknown()),
    rules: z
      .array(
        z
          .object({
            id: IdSchema,
            priority: z.number().int(),
            canonical_match: CollectionMatchSchema,
            prerequisites: z
              .object({ evidence_released: z.array(IdSchema).min(1) })
              .strict()
              .optional(),
            advance_business_days: z.number().int().nonnegative(),
            resource_cost: z.record(z.number().finite().nonnegative()),
            releases: z.array(IdSchema).min(1),
            risk: z
              .object({
                level: z.enum(["low", "moderate", "high"]),
                suggest_staff_review: z.boolean(),
                blocks_sandbox_work: z.literal(false),
              })
              .strict()
              .optional(),
            student_result_note: TextSchema,
            pre_action_coaching: z.literal("none"),
          })
          .strict(),
      )
      .min(1),
    fallback: z
      .object({
        id: IdSchema,
        availability: z.literal("unavailable"),
        advance_business_days: z.literal(0),
        releases: z.array(IdSchema).length(0),
        student_result_note: TextSchema,
      })
      .strict(),
  })
  .strict();

const EconomicValueSchema = z
  .object({
    value: z.union([z.number().finite(), TextSchema]),
    fact_id: IdSchema.optional(),
    evidence_class: TextSchema.optional(),
    evidence_id: IdSchema.optional(),
    calculation: TextSchema.optional(),
    caveat: TextSchema.optional(),
  })
  .strict();

export const EconomicsFileSchema = z
  .object({
    schema_version: z.string(),
    currency: z.string().min(1),
    fixed_inputs: z.record(z.union([EconomicValueSchema, z.number().finite(), TextSchema])),
    measurable_after_collection: z.record(EconomicValueSchema),
    student_owned_inputs: z.array(TextSchema).min(1),
    calculation_rules: z.array(TextSchema).min(1),
    author_note: TextSchema,
  })
  .strict();

export const BoundariesFileSchema = z
  .object({
    schema_version: z.string(),
    unacceptable_outcomes: z.array(z.object({ id: IdSchema, text: TextSchema }).strict()).min(1),
    defensible_response_families_non_exhaustive: z
      .array(
        z
          .object({ id: IdSchema, response: TextSchema, can_be_effective_when: TextSchema })
          .strict(),
      )
      .min(1),
    minimum_decision_standard: z.array(TextSchema).min(1),
  })
  .strict();

export const AnchorsFileSchema = z
  .object({
    schema_version: z.string(),
    visibility: z.literal("staff_only"),
    judgment_scale: z.array(z.string()).length(3),
    overall_rule: TextSchema,
    competencies: z.record(z.unknown()),
    case_specific_traps: z.array(TextSchema).min(1),
    defensible_outcomes: z.array(TextSchema).min(1),
    calibration_note: TextSchema,
  })
  .strict();

export const SourcePinsFileSchema = z
  .object({
    case_origin: z
      .object({
        type: z.enum(["original_from_blank", "sanitized_reference_assisted"]),
        disclosure: z.literal("private_staff_only"),
        real_client_material_used: z.boolean(),
      })
      .strict(),
    approved_scope: z.object({ digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
    ai_lab: z
      .object({
        repository_path: TextSchema,
        source_ref: TextSchema,
        commit: z.string().regex(/^[a-f0-9]{40}$/),
        files: z.array(TextSchema).min(1),
        interpretation: z.record(z.unknown()),
      })
      .strict(),
    volta_intelligence: z
      .object({
        repository_path: TextSchema,
        commit: z.string().regex(/^[a-f0-9]{40}$/),
        articles: z
          .array(
            z
              .object({ id: IdSchema, content_sha256: z.string().regex(/^[a-f0-9]{64}$/) })
              .strict(),
          )
          .min(1),
        pinned_principles: z.array(TextSchema).min(1),
      })
      .strict(),
  })
  .strict();

export const CalibrationFileSchema = z
  .object({
    calibration_id: IdSchema,
    rating: z.enum(["effective", "partially_effective", "not_yet_effective"]),
    not_an_answer_key: z.literal(true),
    evaluator_rationale: TextSchema,
  })
  .passthrough();

export const ValidationRecordSchema = z
  .object({ validated_at: z.string().datetime({ offset: true }) })
  .passthrough();

export const RouteValidationFileSchema = z
  .object({
    schema_version: z.string(),
    resolution_contract: z.record(z.unknown()),
    test_cases: z
      .array(
        z
          .object({
            id: IdSchema,
            route_type: z.enum(["persona", "collection"]),
            persona_id: IdSchema.optional(),
            canonical_intent_ids: z.array(IdSchema),
            released_evidence_ids: z.array(IdSchema).optional(),
            expected: z
              .object({
                status: z.enum(["matched", "ambiguous", "unavailable"]),
                route_id: IdSchema.nullable().optional(),
                fact_ids: z.array(IdSchema).optional(),
                evidence_ids: z.array(IdSchema).optional(),
                advance_business_days: z.number().int().nonnegative().optional(),
              })
              .strict(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
