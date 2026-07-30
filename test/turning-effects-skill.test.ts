import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const skillPath = path.join(
  process.cwd(),
  ".agents",
  "skills",
  "olevel-turning-effects",
  "SKILL.md",
);

test("Turning Effects skill defines varied O Level question types and the no-trigonometry boundary", () => {
  const skill = fs.readFileSync(skillPath, "utf8");

  assert.match(skill, /^name: olevel-turning-effects$/m);
  assert.match(skill, /perpendicular-distance identification/i);
  assert.match(skill, /principle of moments/i);
  assert.match(skill, /centre of gravity/i);
  assert.match(skill, /stability and toppling/i);
  assert.match(skill, /Never resolve a force/i);
  assert.match(skill, /Never use sine, cosine, tangent, inverse trigonometry/i);
  assert.match(
    skill,
    /identifying which already-labelled segment is the perpendicular distance/i,
  );
  assert.match(
    skill,
    /Increase difficulty[\s\S]{0,120}never through trigonometry/i,
  );
});
