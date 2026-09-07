# Generating a problem with interviewable people

## Default setting and language

Assume a small business unless the user explicitly asks for a different setting. Do not invent departments, committees, specialist executives or formal buying processes. One person may pay the bills, choose the software and help with the day-to-day work.

Write people as they would speak to someone visiting their workplace. Use short, natural answers about what happened, what makes their day harder and what they need. Prefer "who pays", "who uses it" and "who looks after it" when characters discuss buying a tool. Keep Economic/Functional/Technical buyer and JTBD labels in teaching notes; characters should not classify themselves or recite the method. Explain those labels in plain English for students.

Do not put phrases such as "operational readiness", "alignment tensions", "desired outcomes", "bounded experiment", "stakeholder", "value proposition" or "sustainable adoption" into a character's mouth unless that person has a specific reason to speak that way. Do not attach a formal evidence summary to every answer. Keep evidence IDs and exercise instructions outside the character's speech.

Read the sample answers aloud before using a case. A small-business owner or employee should sound like a person describing their work, not a consultant giving a presentation. Preserve the facts and uncertainty while changing the wording. Do not make people sound less capable to make them sound more natural.

Every newly authored or generated case must pass the importer with a complete private `profile` for every person in `staff/personas.yaml`. A name and a role prompt are insufficient. This applies to blank fictional cases and cases inspired by sanitized research. Generate all case facts before a run; never manufacture answers during an interview.

## Authoring sequence

1. Frame the recurring problem without prescribing a solution. Define the circumstances, affected work, consequences, competing explanations and missing evidence.
2. Identify the Economic, Functional and Technical buyers. One person can occupy multiple roles, with separately stated jobs, authority and conditions for each. Include users and other stakeholders without assigning them buying authority merely because they use a tool.
3. Write each person's relevant background, responsibilities, daily workflow, personal stakes, voice, incentives, biases and relationships. Define what they know firsthand, read, heard or merely believe. Separate uncertainty from an authored mistaken belief.
4. Give each person one or more Jobs to Be Done: situation, trigger, progress, functional/emotional/social dimensions, current approach, desired outcomes, and the push, pull, anxiety and habits affecting change. Express outcomes without prescribing AI or software. Do not invent measured baselines or numeric targets to fill a field.
5. For each buyer role, link the relevant jobs and specify approval authority, acceptance and rejection conditions, perceived importance, current satisfaction and alignment tensions. Explain adoption mindset and champion status through concrete behaviour.
6. Author at least two concrete episodes per person. Each needs a situation, action, result and supporting fact IDs. Include routine experiences and exceptions. Keep the chronology consistent across characters and records.
7. Provide interview routes for background, jobs, change, episodes and authority. Reference each route in `discoveryRoutes`. Author multiple natural phrasings, including short questions, follow-ups and challenges. Treat equivalent questions consistently. Do not hide facts behind praise or a magic phrase. Route checks must test meaningful paraphrases, ambiguity, unknown topics and resistance to leading questions.
8. Keep full profiles, buyer assignments, episode detail and evaluation anchors private. Student introductions expose name, title and an opening only. Students discover and justify buyer roles and JTBD from released evidence.
9. Rehearse the characters and reconcile contradictions before freezing the version. Check that answers express a person's perspective without coaching toward a preferred solution. Matt or Rishabh judges realism and educational usefulness; validation checks completeness and references only.

Use the exported `PersonaProfileSchema` in `@volta-sim/contracts` as the exact field specification and the public bicycle example as a small non-assessed format example. That example is not a substitute for depth in an assessed case.

## Interview behaviour

Use a separate chat per character and attempt, preserving exact questions, answers and evidence references. A character remembers their own exchanges. Other interview content reaches them only when explicitly supplied through supported simulation actions. Unknown questions release no new facts. A model may express authorized material but must not create incidents, measurements, policies, commitments or knowledge from another character. The current local practice service returns authored route text; profiles alone do not introduce free-form model rendering.

## Verification and versioning

Run `npm run case:validate -- <private-case-directory>` before starting practice. Missing profiles, buyer coverage, knowledge bases or broken references reject import. Profiles become part of protected material and its digest. Material changes require a new case version and approval; existing assignments remain frozen. Legacy direct engine examples remain readable without profiles, but new file-based authoring requires them.

Mandatory student evidence should include: a stakeholder map with Economic/Functional/Technical roles and authority; JTBD supported by interview evidence; each buyer's importance and current-satisfaction assessment; alignment and disagreement; what remains unknown. Do not treat a completed map as proof of alignment, value or effectiveness. A defensible stop or further-discovery decision remains valid.

Sources: [Volta method](https://method.voltaeffect.com), [Christensen Institute JTBD](https://www.christenseninstitute.org/theory/jobs-to-be-done/), [Forces of Progress](https://www.christenseninstitute.org/graphic/the-forces-of-progress/), [Strategyn desired outcomes](https://strategyn.com/outcome-driven-innovation/understanding-customer-needs/), [ASPE role portrayal](https://link.springer.com/article/10.1186/s41077-017-0043-4).
