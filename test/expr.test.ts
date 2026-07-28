import assert from "node:assert/strict";
import { test } from "node:test";
import { ExpressionError, evaluate, evaluateBoolean, evaluateNumber } from "@/lib/template/expr";

test("arithmetic precedence and associativity", () => {
  assert.equal(evaluate("2 + 3 * 4"), 14);
  assert.equal(evaluate("(2 + 3) * 4"), 20);
  assert.equal(evaluate("2 ^ 3 ^ 2"), 512, "^ must be right-associative");
  assert.equal(evaluate("10 - 4 - 3"), 3, "- must be left-associative");
  assert.equal(evaluate("-3 ^ 2"), 9, "unary minus binds tighter than ^ here");
  assert.equal(evaluate("7 % 4"), 3);
});

test("variables shadow built-in constants", () => {
  assert.equal(evaluate("g"), 9.81);
  assert.equal(evaluate("g", { g: 1.62 }), 1.62);
  assert.equal(evaluateNumber("m * g * h", { m: 2, g: 10, h: 3 }), 60);
});

test("functions", () => {
  assert.equal(evaluate("sqrt(16)"), 4);
  assert.equal(evaluate("max(3, 9, 5)"), 9);
  assert.equal(evaluate("round(3.14159, 2)"), 3.14);
  assert.ok(Math.abs((evaluate("sind(30)") as number) - 0.5) < 1e-12);
});

test("comparisons and booleans", () => {
  assert.equal(evaluateBoolean("v > u", { v: 10, u: 4 }), true);
  assert.equal(evaluateBoolean("v > u && t > 0", { v: 10, u: 4, t: 0 }), false);
  assert.equal(evaluateBoolean("!(a == b)", { a: 1, b: 2 }), true);
});

test("rejects unsafe or malformed input", () => {
  // The evaluator must not reach any host capability.
  assert.throws(() => evaluate("process"), ExpressionError);
  assert.throws(() => evaluate("constructor"), ExpressionError);
  assert.throws(() => evaluate("globalThis.process.exit(1)"), ExpressionError);
  assert.throws(() => evaluate("1; 2"), ExpressionError);
  assert.throws(() => evaluate("2 +"), ExpressionError);
  assert.throws(() => evaluate("(1 + 2"), ExpressionError);
  assert.throws(() => evaluate("unknownFn(3)"), ExpressionError);
  assert.throws(() => evaluate("1 / 0"), ExpressionError);
});

test("evaluateNumber rejects non-finite results", () => {
  assert.throws(() => evaluateNumber("sqrt(-1)"), ExpressionError);
  assert.throws(() => evaluateNumber("1 > 0"), ExpressionError);
});
