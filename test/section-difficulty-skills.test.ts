import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const skillRoot = path.join(process.cwd(), ".agents", "skills");

function readSkill(name: string): string {
  return fs.readFileSync(path.join(skillRoot, name, "SKILL.md"), "utf8");
}

test("mechanics skills treat Section A as MCQ format rather than easy difficulty", () => {
  for (const name of [
    "olevel-newtonian-mechanics",
    "olevel-dynamics",
    "olevel-turning-effects",
  ]) {
    const skill = readSkill(name);
    assert.match(skill, /Section A as the multiple-choice section/i);
    assert.match(
      skill,
      /Do\s+not use "Section A" as a synonym for easy/i,
    );
    assert.match(skill, /easy[\s\S]{0,100}foundation level/i);
    assert.match(skill, /medium[\s\S]{0,100}Section B/i);
    assert.match(skill, /hard[\s\S]{0,100}Section C/i);
    assert.match(
      skill,
      /hard non-MCQ[\s\S]{0,220}calculate[\s\S]{0,220}explain/i,
    );
  }
});

test("each mechanics skill records its own Section C question patterns", () => {
  const kinematics = readSkill("olevel-newtonian-mechanics");
  assert.match(kinematics, /Two-object velocity–time graph/i);
  assert.match(kinematics, /separation[\s\S]{0,100}relative velocity/i);
  assert.match(kinematics, /Rebound or direction change/i);

  const dynamics = readSkill("olevel-dynamics");
  assert.match(dynamics, /Multiple bodies and a state change/i);
  assert.match(dynamics, /system boundary/i);
  assert.match(dynamics, /Limiting internal force/i);

  const turningEffects = readSkill("olevel-turning-effects");
  assert.match(turningEffects, /Build Section C hard questions/i);
  assert.match(turningEffects, /select a suitable pivot/i);
  assert.match(turningEffects, /rotational equilibrium/i);
  assert.match(turningEffects, /translational equilibrium/i);
  assert.match(turningEffects, /switch from .*sum M=0.*sum F=0/is);
});

test("paired notes and exercises permanently trigger the topic-skill workflow", () => {
  const workflow = readSkill("build-olevel-topic-skill");
  const projectRules = fs.readFileSync(
    path.join(process.cwd(), "AGENTS.md"),
    "utf8",
  );

  assert.match(
    workflow,
    /Use whenever a Knowledge Base topic gains both notes and exercise material/i,
  );
  assert.match(workflow, /Locate Section A, Section B, and Section C/i);
  assert.match(workflow, /Do not stop after editing `SKILL\.md`/i);
  assert.match(workflow, /quick_validate\.py/i);
  assert.match(workflow, /fresh, read-only forward test/i);

  assert.match(projectRules, /\$build-olevel-topic-skill/);
  assert.match(projectRules, /Treat this workflow as mandatory/i);
  assert.match(
    projectRules,
    /Do not report a paired upload as fully handled after database import alone/i,
  );
});
