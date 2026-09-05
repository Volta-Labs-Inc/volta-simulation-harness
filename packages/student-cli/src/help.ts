const COMMAND_SUMMARIES = [
  ["login", "Pair this checkout with your assigned simulation."],
  ["resume", "Show the current assignment after signing in."],
  ["status", "Show released facts, captured work, and submission readiness."],
  ["talk", "Ask a student-visible persona a question."],
  ["evidence", "Ask a student-visible evidence source a question."],
  ["request", "Alias for evidence."],
  ["collect", "Schedule an available evidence-collection method."],
  ["advance", "Advance simulated time for a stated reason."],
  ["ledger", "Record a fact, assumption, contradiction, or unknown."],
  ["decision", "Record a continue, pivot, buy, collect-more-evidence, or stop decision."],
  ["estimate", "Record an uncertainty range and its assumptions."],
  ["requirement", "Assess one case requirement."],
  ["claim", "Defend one required competency."],
  ["criterion", "Add an objective success or failure criterion."],
  ["criterion-remove", "Remove an erroneous criterion from the working draft."],
  ["calculation", "Record a reproducible calculation."],
  ["calculation-remove", "Remove an incorrect calculation while preserving its history."],
  ["draft", "Record the proposed response and missing-data plan."],
  ["checkpoint", "Show the reflection prompts."],
  ["review-request", "Request, wait for, or decline suggested staff review."],
  ["submit", "Validate readiness and submit the current working draft."],
  ["logout", "Remove the local session token."],
] as const;

const COMMAND_HELP: Readonly<Record<string, string>> = {
  login: `Usage: volta-sim login --operation-id <safe-id>

--operation-id  1-160 letters, numbers, dots, colons, underscores, or hyphens.

Example:
  volta-sim login --operation-id login-1`,
  resume: `Usage: volta-sim resume

Shows the current assignment and does not change simulation state.

Example:
  volta-sim resume`,
  status: `Usage: volta-sim status

Shows available persona, evidence, and collection IDs; released facts; captured ledger and evidence IDs; editable criteria; and the exact submission-readiness report.

Example:
  volta-sim status`,
  talk: `Usage: volta-sim talk --operation-id <safe-id> --persona <persona-id> --question <text>

Use a persona ID shown by status.

Example:
  volta-sim talk --operation-id talk-1 --persona library-manager --question "What outcome would make this worth addressing?"`,
  evidence: `Usage: volta-sim evidence --operation-id <safe-id> --source <evidence-source-id> --question <text>

Use an evidence-source ID shown by status. The command name request is an alias.

Example:
  volta-sim evidence --operation-id evidence-1 --source desk-log --question "What baseline does the released sample support?"`,
  request: `Usage: volta-sim request --operation-id <safe-id> --source <evidence-source-id> --question <text>

Alias for evidence. Use an evidence-source ID shown by status.

Example:
  volta-sim request --operation-id evidence-1 --source desk-log --question "What baseline does the released sample support?"`,
  collect: `Usage: volta-sim collect --operation-id <safe-id> --method <collection-method-id> --plan <text>

Use a collection-method ID shown by status. The plan must state what you will collect and why it changes the decision.

Example:
  volta-sim collect --operation-id collect-1 --method sample-audit --plan "Measure wait distribution and answer corrections before choosing an intervention."`,
  advance: `Usage: volta-sim advance --operation-id <safe-id> --days <1-3650> --reason <text>

Example:
  volta-sim advance --operation-id advance-1 --days 7 --reason "Wait for the scheduled audit."`,
  ledger: `Usage: volta-sim ledger --operation-id <safe-id> --kind <value> --statement <text> [--fact-id <released-fact-id> ...]

Allowed --kind values:
  fact | assumption | contradiction | unknown

A fact must cite at least one fact ID shown under status.releasedEvidence. Other kinds must not cite fact IDs. The response prints the captured evidence IDs used by decision, requirement, and claim.

Example:
  volta-sim ledger --operation-id ledger-1 --kind fact --statement "Median response time is 18 minutes." --fact-id median-wait`,
  decision: `Usage: volta-sim decision --operation-id <safe-id> --choice <value> --rationale <text> [--evidence-id <captured-evidence-id> ...] --expected-evidence <tuple> [--expected-evidence <tuple> ...] --pivot-condition <tuple> [--pivot-condition <tuple> ...]

Allowed --choice values:
  continue | pivot | buy | collect-more-evidence | stop

Formats:
  --evidence-id       Use an exact ID printed by ledger or status.capturedEvidence.
  --expected-evidence description|source-or-method|decision-use
  --pivot-condition   pivot-or-stop|condition|rationale

Example:
  volta-sim decision --operation-id decision-1 --choice collect-more-evidence --rationale "Accuracy is unknown." --evidence-id evidence-ledger-1-median-wait --expected-evidence "Accuracy sample|Sample audit|Decide whether to proceed" --pivot-condition "stop|Accuracy falls|Protect answer quality"`,
  estimate: `Usage: volta-sim estimate --operation-id <safe-id> --subject <text> --low <number> --high <number> --unit <text> --assumption <text> [--assumption <text> ...] --confidence <0-1>

The high value must be at least the low value. Confidence is a decimal from 0 to 1.

Example:
  volta-sim estimate --operation-id estimate-1 --subject "Audit time" --low 4 --high 12 --unit hours --assumption "Anonymized logs are available." --confidence 0.4`,
  requirement: `Usage: volta-sim requirement --operation-id <safe-id> --id <requirement-id> --status <value> --rationale <text> [--evidence-id <captured-evidence-id> ...]

Allowed --status values:
  addressed | not-yet | not-applicable

Use requirement IDs shown by status and evidence IDs printed by ledger or status.capturedEvidence.

Example:
  volta-sim requirement --operation-id requirement-1 --id patron-wait --status not-yet --rationale "The target and accuracy baseline are missing." --evidence-id evidence-ledger-1-median-wait`,
  claim: `Usage: volta-sim claim --operation-id <safe-id> --competency <value> --rationale <text> [--evidence-id <captured-evidence-id> ...]

Allowed --competency values:
  problem-viability | evidence-sufficiency | response-feasibility | objective-success-criteria

Each submission needs exactly one claim for every listed competency.

Example:
  volta-sim claim --operation-id claim-1 --competency evidence-sufficiency --rationale "I separated the released baseline from unknown accuracy." --evidence-id evidence-ledger-1-median-wait`,
  criterion: `Usage: volta-sim criterion --operation-id <safe-id> --metric <text> (--baseline <text> | --baseline-plan <text>) --target <text> --target-date <date> --failure-threshold <text>

Target date format:
  YYYY-MM-DD, for example 2026-10-31. An ISO 8601 datetime with an explicit offset is also accepted.

The response prints a criterion ID. Use criterion-remove with that ID if the entry is wrong.

Example:
  volta-sim criterion --operation-id criterion-1 --metric "Median first response" --baseline "18 minutes" --target "At most 12 minutes" --target-date 2026-10-31 --failure-threshold "Stop above 18 minutes"`,
  "criterion-remove": `Usage: volta-sim criterion-remove --operation-id <safe-id> --id <criterion-id>

Use a criterion ID printed when it was recorded or shown by status.successCriteria. Removal changes only the working draft; the original action remains in the attempt history.

Example:
  volta-sim criterion-remove --operation-id criterion-remove-1 --id criterion-criterion-1`,
  calculation: `Usage: volta-sim calculation --operation-id <safe-id> --name <text> --input <tuple> [--input <tuple> ...] --operation <value> --input-name <name> [--input-name <name> ...] --result <number> --result-unit <text> --rationale <text>

Arithmetic and supported unit rules are checked before saving. The reply returns the calculation ID; status shows your saved calculations.

Allowed --operation values:
  sum | difference | product | quotient | percentage-change

Input format:
  name|number|unit|source

Example:
  volta-sim calculation --operation-id calculation-1 --name "Audit cost" --input "hours|4|hours|student estimate" --input "rate|75|CAD per hour|student assumption" --operation product --input-name hours --input-name rate --result 300 --result-unit CAD --rationale "Bound the collection cost."`,
  "calculation-remove": `Usage: volta-sim calculation-remove --operation-id <safe-id> --id <calculation-id>

Use the exact ID from status.calculations. Removes the entry from the working draft and keeps its full history. Add a new calculation with corrected inputs afterward.

Example:
  volta-sim calculation-remove --operation-id remove-cost-1 --id calculation-calculation-1`,
  draft: `Usage: volta-sim draft --operation-id <safe-id> --mode <value> --rationale <text> --feasibility <text> --risk <text> [--risk <text> ...] --missing-data-plan <text> --economic-rationale <text>

Allowed --mode values:
  build | pilot | buy | data-collection | no-build

Example:
  volta-sim draft --operation-id draft-1 --mode data-collection --rationale "Measure before committing." --feasibility "A bounded audit is available." --risk "The sample may be unrepresentative." --missing-data-plan "Measure accuracy and volume." --economic-rationale "Do not invent savings before volume is known."`,
  checkpoint: `Usage: volta-sim checkpoint

Shows reflection prompts and does not change simulation state.

Example:
  volta-sim checkpoint`,
  "review-request": `Usage: volta-sim review-request --operation-id <safe-id> --topic <text> --choice <value>

Allowed --choice values:
  continue | wait | decline

Example:
  volta-sim review-request --operation-id review-1 --topic "Review the bounded audit plan." --choice continue`,
  submit: `Usage: volta-sim submit --operation-id <safe-id> [--artifact <tracked-path> ...]

Run status first. Build and pilot responses select explicit tracked .txt, .md, .csv, or .json artifacts. No-build responses cannot include artifacts. A not-ready or rejected submission exits nonzero.

Example:
  volta-sim submit --operation-id submit-1`,
  logout: `Usage: volta-sim logout --operation-id <safe-id>

Example:
  volta-sim logout --operation-id logout-1`,
};

export function globalHelp(): string {
  const commands = COMMAND_SUMMARIES.map(
    ([name, summary]) => `  ${name.padEnd(18)} ${summary}`,
  ).join("\n");
  return `Volta Simulation Harness student CLI

Usage:
  volta-sim <command> [options]
  volta-sim help <command>
  volta-sim <command> --help

Available commands:
${commands}

Run volta-sim help <command> for allowed values, formats, and an example.`;
}

export function commandHelp(command: string): string | undefined {
  return COMMAND_HELP[command];
}
