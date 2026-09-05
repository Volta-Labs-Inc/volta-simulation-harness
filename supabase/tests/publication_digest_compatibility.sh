#!/usr/bin/env bash
set -euo pipefail

sim_root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
sim_db_container="supabase_db_volta-simulation-harness"
cd "$sim_root_dir"

npm run build --silent
supabase db reset --local >/dev/null

sim_fixture_line="$(node --input-type=module <<'NODE'
import { createHash } from "node:crypto";
import { canonicalSerialize } from "./packages/core/dist/canonical.js";
import { createCaseVersionDigests } from "./packages/core/dist/case-version.js";
import { importCaseDirectory } from "./packages/authoring/dist/importer.js";

const rawDigest = (text) => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
const b64 = (text) => Buffer.from(text, "utf8").toString("base64");
const artifacts = ["effective", "partially-effective", "not-yet-effective"].map((rating) => {
  const text = canonicalSerialize({ rating });
  return { rating, text, digest: rawDigest(text) };
});
const source = structuredClone((await importCaseDirectory(
  "./packages/authoring/test/fixtures/non-assessed-bicycle-library",
)).source);
source.protected.calibrationAnchors = artifacts.map(({ rating, digest }) => ({
  class: rating,
  artifactDigest: digest,
  rationale: `Synthetic ${rating} calibration`,
}));
const content = "# Synthetic\n";
const contentDigest = rawDigest(content);
const descriptors = [{ byteLength: Buffer.byteLength(content), digest: contentDigest, path: "README.md" }];
const manifestDigest = rawDigest(canonicalSerialize(descriptors));
const materialization = {
  manifestDigest,
  files: [{
    path: "README.md",
    mediaType: "text/markdown",
    byteLength: Buffer.byteLength(content),
    digest: contentDigest,
    content,
  }],
};
const visibleText = canonicalSerialize(source.visible);
const protectedText = canonicalSerialize(source.protected);
const fields = [
  source.visible.caseId,
  source.visible.versionLabel,
  b64(visibleText),
  rawDigest(visibleText),
  b64(protectedText),
  rawDigest(protectedText),
  createCaseVersionDigests(source).caseVersionDigest,
  b64(canonicalSerialize(source.methodologySnapshot)),
  b64(canonicalSerialize(source.requirementsSnapshot)),
  b64(canonicalSerialize(materialization)),
  manifestDigest,
  ...artifacts.flatMap(({ rating, text, digest }) => [rating, b64(text), digest]),
];
process.stdout.write(fields.join("|"));
NODE
)"

IFS='|' read -r \
  sim_case_id sim_version_label sim_visible_b64 sim_visible_digest \
  sim_protected_b64 sim_protected_digest sim_draft_digest sim_methodology_b64 \
  sim_requirements_b64 sim_materialization_b64 sim_manifest_digest \
  sim_class_one sim_artifact_one_b64 sim_artifact_one_digest \
  sim_class_two sim_artifact_two_b64 sim_artifact_two_digest \
  sim_class_three sim_artifact_three_b64 sim_artifact_three_digest \
  <<<"$sim_fixture_line"

docker exec -i "$sim_db_container" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
  -v case_id="$sim_case_id" \
  -v version_label="$sim_version_label" \
  -v visible_b64="$sim_visible_b64" \
  -v visible_digest="$sim_visible_digest" \
  -v protected_b64="$sim_protected_b64" \
  -v protected_digest="$sim_protected_digest" \
  -v draft_digest="$sim_draft_digest" \
  -v methodology_b64="$sim_methodology_b64" \
  -v requirements_b64="$sim_requirements_b64" \
  -v materialization_b64="$sim_materialization_b64" \
  -v manifest_digest="$sim_manifest_digest" \
  -v class_one="$sim_class_one" \
  -v artifact_one_b64="$sim_artifact_one_b64" \
  -v artifact_one_digest="$sim_artifact_one_digest" \
  -v class_two="$sim_class_two" \
  -v artifact_two_b64="$sim_artifact_two_b64" \
  -v artifact_two_digest="$sim_artifact_two_digest" \
  -v class_three="$sim_class_three" \
  -v artifact_three_b64="$sim_artifact_three_b64" \
  -v artifact_three_digest="$sim_artifact_three_digest" <<'SQL' >/dev/null
insert into auth.users (
  id, email, aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '91000000-0000-4000-8000-000000000001', 'digest-author@example.test',
  'authenticated', 'authenticated', '{}', '{}', now(), now()
);
insert into auth.identities (
  id, provider_id, user_id, identity_data, provider, created_at, updated_at
) values (
  '92000000-0000-4000-8000-000000000001', '901',
  '91000000-0000-4000-8000-000000000001',
  '{"sub":"901","user_name":"digest-author"}', 'github', now(), now()
);
select private.sync_github_identity('91000000-0000-4000-8000-000000000001');
insert into private.case_author_grants (staff_identity_id, case_id)
select id, :'case_id' from public.github_identities where github_user_id = 901;

select private.record_case_validation(
  '91000000-0000-4000-8000-000000000001',
  'digest-compatible-validation', :'case_id', :'version_label',
  convert_from(decode(:'visible_b64', 'base64'), 'UTF8'), :'visible_digest',
  convert_from(decode(:'materialization_b64', 'base64'), 'UTF8')::jsonb,
  :'manifest_digest',
  convert_from(decode(:'protected_b64', 'base64'), 'UTF8'), :'protected_digest',
  :'draft_digest',
  convert_from(decode(:'methodology_b64', 'base64'), 'UTF8')::jsonb,
  convert_from(decode(:'requirements_b64', 'base64'), 'UTF8')::jsonb,
  jsonb_build_array(
    jsonb_build_object(
      'class', :'class_one',
      'canonicalArtifactText', convert_from(decode(:'artifact_one_b64', 'base64'), 'UTF8'),
      'artifactDigest', :'artifact_one_digest'
    ),
    jsonb_build_object(
      'class', :'class_two',
      'canonicalArtifactText', convert_from(decode(:'artifact_two_b64', 'base64'), 'UTF8'),
      'artifactDigest', :'artifact_two_digest'
    ),
    jsonb_build_object(
      'class', :'class_three',
      'canonicalArtifactText', convert_from(decode(:'artifact_three_b64', 'base64'), 'UTF8'),
      'artifactDigest', :'artifact_three_digest'
    )
  ),
  true,
  '[]'
);

select * from private.approve_case_version(
  '91000000-0000-4000-8000-000000000001',
  (select id from private.case_validations where client_operation_id = 'digest-compatible-validation'),
  'digest-compatible-approval', :'visible_digest', :'manifest_digest',
  :'protected_digest', :'draft_digest'
);
SQL

sim_receipt_line="$(docker exec "$sim_db_container" psql -U postgres -d postgres -X -Atc \
  "select translate(encode(convert_to(canonical_approved_source_text, 'UTF8'), 'base64'), E'\\n', '') || '|' || case_version_digest from private.case_version_publications")"
IFS='|' read -r sim_source_b64 sim_db_digest <<<"$sim_receipt_line"

SIM_SOURCE_B64="$sim_source_b64" SIM_DB_DIGEST="$sim_db_digest" node --input-type=module <<'NODE'
import { createCaseVersionDigests } from "./packages/core/dist/case-version.js";

const source = JSON.parse(Buffer.from(process.env.SIM_SOURCE_B64, "base64").toString("utf8"));
const coreDigest = createCaseVersionDigests(source).caseVersionDigest;
if (coreDigest !== process.env.SIM_DB_DIGEST) {
  throw new Error(`Database digest ${process.env.SIM_DB_DIGEST} did not match core digest ${coreDigest}`);
}
NODE

echo "PASS: the database-approved canonical source reproduces its final digest in the core runtime"
