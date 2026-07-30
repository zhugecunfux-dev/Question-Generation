# Project Operating Rules

## Paired notes and exercises

Whenever newly uploaded or imported Knowledge Base material contains both notes
and exercises for the same O Level Physics topic, use
`$build-olevel-topic-skill` from
`.agents/skills/build-olevel-topic-skill/SKILL.md`.

Treat this workflow as mandatory:

1. analyse the notes and exercise structure, treating Section A as the MCQ
   format section rather than as a synonym for easy, Section B as the structured
   reference, and Section C as the free-response reference;
2. create or update the matching project-local topic skill;
3. record topic-specific question types, hard-question patterns, syllabus
   boundaries, diagrams, and marking rules;
4. sync those rules into the live question generator and output validation;
5. add tests, validate the skill, run type checks and the full test suite, and
   perform a fresh hard-question forward test.

Do not report a paired upload as fully handled after database import alone. If
only notes or only exercises are present, record the topic-skill workflow as
pending until its matching source is available.
