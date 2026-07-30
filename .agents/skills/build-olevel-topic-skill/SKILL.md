---
name: build-olevel-topic-skill
description: Convert newly uploaded or imported Singapore O Level Physics topic notes plus exercises into a durable project-local topic skill and matching live question-generation rules. Use whenever a Knowledge Base topic gains both notes and exercise material, when a new topic bundle is imported, or when the user asks to create, refresh, or calibrate a topic skill from those sources.
---

# Build an O Level Topic Skill

Treat a paired notes-and-exercises upload as content-engineering work, not as a
completed file import. Analyse the sources, create or update the topic skill,
sync the production generator, and verify the result.

## Apply the trigger and completion boundary

- Run this workflow whenever the Knowledge Base contains newly uploaded notes
  and exercises for the same topic.
- If only one source type is present, inspect and import what is available but
  report that the topic-skill workflow remains pending. Do not invent the
  missing source's difficulty patterns.
- Reuse and improve an existing topic skill. Create a new project-local skill
  under `.agents/skills/` only when no matching skill exists.
- Do not call the upload complete merely because the files or database rows
  were imported. Completion requires the topic skill, live generator rules,
  tests, and validation described below.

## Analyse the uploaded material

1. Identify the topic ID, syllabus title, notes sources, exercise sources, and
   any structured JSON or page metadata that can recover headings lost in OCR.
2. Read the notes for scope, definitions, notation, conventions, required
   methods, diagrams, common misconceptions, and explicitly excluded methods.
3. Locate Section A, Section B, and Section C in the exercises. When an OCR
   conversion loses a heading, use question numbering, page metadata, source
   JSON, mark totals, and the change in question structure to establish the
   boundary. Do not automatically classify unsectioned material before the
   first explicit Section A heading as Section A.
4. Analyse whole questions rather than labelling isolated one-mark subparts.
   Record the number of linked steps, amount of scaffolding, representation
   changes, system or state changes, calculations, explanations, and typical
   mark totals.
5. Extract a varied, topic-specific question-type catalogue and reusable
   Section C patterns. Summarise patterns; never copy source questions or their
   distinctive wording.
6. Record topic-specific safety boundaries. Examples include forbidden
   mathematics, required directly supplied data, syllabus conventions, or
   distinctions that generated questions commonly mishandle.

## Calibrate format and difficulty from the exercises

Use this default mapping unless the uploaded sources clearly establish a
different named structure:

- **Section A — MCQ format:** use it to learn multiple-choice stem style,
  four-option construction, and misconception-based distractors. Do not equate
  Section A with easy; its MCQs may be assigned different cognitive
  difficulties.
- **Easy — foundation difficulty:** one basic concept, direct reading,
  identification, or one-step calculation; normally 1–3 marks for a written
  question.
- **Medium — Section B:** a clearly scaffolded structured problem with one or
  two linked calculations or a short explanation; normally 3–6 marks.
- **Hard — Section C:** one coherent free-response context with reduced
  scaffolding, several dependent physics steps, and normally 7–12 marks.

If source mark totals are absent, say so. Use these ranges only as production
generation calibration; never present inferred totals as marks printed in the
uploaded exercise.

Require every hard non-MCQ question to include:

1. an explicit calculate, determine, deduce, or show-that task;
2. an explicit explain, justify, evaluate, or reasoned-comparison task;
3. a later part that uses, checks, compares, or interprets earlier work.

Create difficulty through physics modelling, representation changes, system
choice, state changes, or evaluation. Do not substitute larger numbers,
tedious arithmetic, obscure language, or out-of-syllabus mathematics.

## Create or update the topic skill

For a new skill, use the skill-creator initializer and follow the established
project naming pattern. For an existing skill, preserve correct topic knowledge
while adding the new evidence.

Make every topic skill contain:

- triggering metadata that names the topic and its common tasks;
- syllabus scope, notation, numerical conventions, and excluded methods;
- a varied question-type catalogue;
- the Section A MCQ-format rule and the easy/medium/hard difficulty contract;
- concrete, reusable Section C hard-question patterns;
- diagram and data-presentation rules where relevant;
- solution and marking guidance;
- common-error guardrails derived from the notes and exercises.

Keep the skill concise. Store procedural and topic-specific guidance, not a
second copy of the uploaded notes. Ensure `agents/openai.yaml` still matches the
skill metadata.

## Sync the production generator

Do not stop after editing `SKILL.md`. Inspect the live generation path and make
the smallest maintainable changes needed to apply the new topic rules:

- register and rotate the topic's Section C patterns for hard written slots;
- put trusted Section A format and easy/medium/hard calibration after untrusted
  Knowledge Base excerpts, teacher notes, and bank exemplars;
- retrieve Section A when calibrating MCQ format, and retrieve Section B or C
  when calibrating medium or hard written difficulty respectively; do not
  retrieve Section A merely because a written question is easy;
- prefer written formats for hard questions when the requested format mix
  allows it;
- reject hard written output that lacks the required calculation, explanation,
  mark range, or topic-specific method;
- reject source exemplars that conflict with the current topic boundaries;
- retain any topic-specific diagram or prohibited-method checks.

Use a shared configuration when the generator already supports it; add a
topic-specific branch only when the physics genuinely differs. Preserve
existing database content and unrelated generated assets.

## Verify the workflow

Add or update tests that cover:

- the topic skill's required sections and subject-specific patterns;
- slot planning and pattern assignment;
- trusted prompt rules appearing after reference data;
- difficulty mark ranges and calculation-plus-explanation validation;
- topic-specific accepted and rejected methods;
- retrieval of the correct exercise section when practical.

Then:

1. run the skill-creator `quick_validate.py` against every changed skill;
2. run the project type checker;
3. run the complete automated test suite;
4. run a fresh, read-only forward test with a normal request to generate one
   hard free-response question using the topic skill;
5. inspect the result for Section C structure, correct physics, calculation,
   explanation, dependency between parts, and all topic boundaries.

Do not leak the expected pattern or answer into the forward-test request.

## Report the result

State:

- the observed Section B and Section C question patterns;
- the resulting easy, medium, and hard calibration;
- the skill and generator files changed;
- validation, type-check, test, and forward-test results;
- whether the changes are only local or have also been pushed.

Make clear that the new rules affect newly generated questions and do not
silently rewrite existing bank questions.
