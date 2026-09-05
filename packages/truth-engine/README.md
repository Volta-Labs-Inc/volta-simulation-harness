# Truth and provider engine

This server-only package turns one authorized simulation request into one auditable outcome. Authored routes choose the facts and consequences before any renderer runs. A renderer may order exact authored fact claims and response-point text; it cannot add or paraphrase student-visible prose.

The assembled text is returned under `generatedWording` with `generatedWordingIsAuthoritative: false`. Official facts and provenance are returned separately from the deterministic route plan. Provider-supplied source IDs and text must match the prepared prompt exactly before an action can commit.

Local capture and mock renderers prove prompt minimization, failure handling, idempotency, and replay without sending data to a hosted provider. The OpenAI boundary accepts only the two dated pilot models and the fixed Responses API endpoint. Hosted use remains disabled until Volta records a valid credential, exact-model availability, and the provider data-control review.

The in-memory stores are proof fixtures, not hosted persistence. The hosted service must supply durable operation and truth-state stores, use the private assignment record as the authority for the case digest and current attempt, and recheck authorization under the same lock or transaction that commits the truth event after provider work.

This boundary deliberately does not claim that arbitrary model paraphrases can be proven faithful. Free-form generated wording stays disabled unless a future deterministic verifier can reject every unsupported claim; the current provider role is limited to arranging exact authored material.
