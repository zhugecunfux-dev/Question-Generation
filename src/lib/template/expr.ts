/**
 * A tiny arithmetic/boolean expression evaluator for question templates.
 *
 * Templates come from a question bank, which is user-supplied data — so this
 * deliberately does NOT use `eval`/`new Function`. It is a hand-written
 * tokenizer + Pratt parser over a fixed grammar:
 *
 *   numbers, identifiers, ( ), unary -, + - * / % ^,
 *   comparisons < <= > >= == != , boolean && || !,
 *   and a fixed whitelist of maths functions.
 */

export type Scope = Record<string, number | string | boolean>;

type NumericFn = (...args: number[]) => number;

/** Copy onto a null-prototype object — see the note on FUNCTIONS below. */
function nullProto<T extends object>(source: T): T {
  return Object.assign(Object.create(null) as T, source);
}

// Null-prototype maps: with a plain object literal, `constructor`, `toString`,
// `__proto__` etc. resolve through Object.prototype, which would hand an
// expression a real host function to call.
const FUNCTIONS: Record<string, NumericFn> = nullProto<Record<string, NumericFn>>({
  abs: Math.abs,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  ln: Math.log,
  log: Math.log10,
  exp: Math.exp,
  floor: Math.floor,
  ceil: Math.ceil,
  round: (x, d = 0) => {
    const f = 10 ** d;
    return Math.round(x * f) / f;
  },
  min: (...a) => Math.min(...a),
  max: (...a) => Math.max(...a),
  sign: Math.sign,
  hypot: (...a) => Math.hypot(...a),
  // degrees <-> radians, handy for optics/forces questions
  rad: (d) => (d * Math.PI) / 180,
  deg: (r) => (r * 180) / Math.PI,
  sind: (d) => Math.sin((d * Math.PI) / 180),
  cosd: (d) => Math.cos((d * Math.PI) / 180),
  tand: (d) => Math.tan((d * Math.PI) / 180),
});

const CONSTANTS: Record<string, number> = nullProto<Record<string, number>>({
  pi: Math.PI,
  e: Math.E,
  /** Earth's gravitational field strength, as used throughout 6091. */
  g: 9.81,
});

// --- Tokenizer -------------------------------------------------------------

type Token =
  | { t: "num"; v: number }
  | { t: "ident"; v: string }
  | { t: "op"; v: string }
  | { t: "("; }
  | { t: ")"; }
  | { t: ","; };

const OPERATORS = [
  "<=", ">=", "==", "!=", "&&", "||",
  "+", "-", "*", "/", "%", "^", "<", ">", "!",
];

export class ExpressionError extends Error {}

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (c === "(") { out.push({ t: "(" }); i++; continue; }
    if (c === ")") { out.push({ t: ")" }); i++; continue; }
    if (c === ",") { out.push({ t: "," }); i++; continue; }

    if (/[0-9.]/.test(c)) {
      const m = /^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?/.exec(src.slice(i));
      if (!m) throw new ExpressionError(`bad number at position ${i} in "${src}"`);
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }

    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      out.push({ t: "ident", v: m[0] });
      i += m[0].length;
      continue;
    }

    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (op) {
      out.push({ t: "op", v: op });
      i += op.length;
      continue;
    }

    throw new ExpressionError(`unexpected character "${c}" in "${src}"`);
  }
  return out;
}

// --- Parser (Pratt / precedence climbing) ----------------------------------

// Higher binds tighter. `^` is right-associative.
const BINARY_PRECEDENCE: Record<string, number> = {
  "||": 1,
  "&&": 2,
  "==": 3, "!=": 3,
  "<": 4, "<=": 4, ">": 4, ">=": 4,
  "+": 5, "-": 5,
  "*": 6, "/": 6, "%": 6,
  "^": 7,
};

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[], private readonly src: string) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): Token {
    const tok = this.tokens[this.pos++];
    if (!tok) throw new ExpressionError(`unexpected end of expression "${this.src}"`);
    return tok;
  }

  parse(scope: Scope): number | boolean {
    const value = this.parseExpr(0, scope);
    if (this.pos !== this.tokens.length) {
      throw new ExpressionError(`trailing input in "${this.src}"`);
    }
    return value;
  }

  private parseExpr(minPrec: number, scope: Scope): number | boolean {
    let left = this.parseUnary(scope);
    for (;;) {
      const tok = this.peek();
      if (!tok || tok.t !== "op") break;
      const prec = BINARY_PRECEDENCE[tok.v];
      if (prec === undefined || prec < minPrec) break;
      this.pos++;
      // `^` is right-associative, everything else is left-associative.
      const right = this.parseExpr(tok.v === "^" ? prec : prec + 1, scope);
      left = applyBinary(tok.v, left, right, this.src);
    }
    return left;
  }

  private parseUnary(scope: Scope): number | boolean {
    const tok = this.peek();
    if (tok && tok.t === "op" && (tok.v === "-" || tok.v === "+" || tok.v === "!")) {
      this.pos++;
      const operand = this.parseUnary(scope);
      if (tok.v === "!") return !truthy(operand);
      const n = num(operand, this.src);
      return tok.v === "-" ? -n : n;
    }
    return this.parsePrimary(scope);
  }

  private parsePrimary(scope: Scope): number | boolean {
    const tok = this.next();

    if (tok.t === "num") return tok.v;

    if (tok.t === "(") {
      const v = this.parseExpr(0, scope);
      const close = this.next();
      if (close.t !== ")") throw new ExpressionError(`expected ")" in "${this.src}"`);
      return v;
    }

    if (tok.t === "ident") {
      const nextTok = this.peek();
      if (nextTok && nextTok.t === "(") {
        this.pos++;
        const args: number[] = [];
        if (this.peek()?.t !== ")") {
          for (;;) {
            args.push(num(this.parseExpr(0, scope), this.src));
            const sep = this.peek();
            if (sep && sep.t === ",") { this.pos++; continue; }
            break;
          }
        }
        const close = this.next();
        if (close.t !== ")") throw new ExpressionError(`expected ")" after args in "${this.src}"`);
        const fn = Object.prototype.hasOwnProperty.call(FUNCTIONS, tok.v)
          ? FUNCTIONS[tok.v]
          : undefined;
        if (typeof fn !== "function") throw new ExpressionError(`unknown function "${tok.v}"`);
        return fn(...args);
      }

      if (tok.v === "true") return true;
      if (tok.v === "false") return false;

      // Scope shadows the built-in constants, so a template may define its own
      // `g` (e.g. a different planet) without fighting the default.
      if (Object.prototype.hasOwnProperty.call(scope, tok.v)) {
        const v = scope[tok.v];
        if (typeof v === "string") {
          const asNumber = Number(v);
          if (!Number.isNaN(asNumber) && v.trim() !== "") return asNumber;
          throw new ExpressionError(`variable "${tok.v}" is a non-numeric string`);
        }
        return v;
      }
      if (Object.prototype.hasOwnProperty.call(CONSTANTS, tok.v)) return CONSTANTS[tok.v];

      throw new ExpressionError(`unknown identifier "${tok.v}"`);
    }

    throw new ExpressionError(`unexpected token in "${this.src}"`);
  }
}

function truthy(v: number | boolean): boolean {
  return typeof v === "boolean" ? v : v !== 0;
}

function num(v: number | boolean, src: string): number {
  if (typeof v === "number") return v;
  throw new ExpressionError(`expected a number but got a boolean in "${src}"`);
}

function applyBinary(
  op: string,
  left: number | boolean,
  right: number | boolean,
  src: string,
): number | boolean {
  switch (op) {
    case "&&": return truthy(left) && truthy(right);
    case "||": return truthy(left) || truthy(right);
    case "==": return left === right;
    case "!=": return left !== right;
  }
  const a = num(left, src);
  const b = num(right, src);
  switch (op) {
    case "+": return a + b;
    case "-": return a - b;
    case "*": return a * b;
    case "/":
      if (b === 0) throw new ExpressionError(`division by zero in "${src}"`);
      return a / b;
    case "%":
      if (b === 0) throw new ExpressionError(`modulo by zero in "${src}"`);
      return a % b;
    case "^": return a ** b;
    case "<": return a < b;
    case "<=": return a <= b;
    case ">": return a > b;
    case ">=": return a >= b;
    default: throw new ExpressionError(`unknown operator "${op}"`);
  }
}

const cache = new Map<string, Token[]>();

/** Evaluate `src` against `scope`. Throws `ExpressionError` on bad input. */
export function evaluate(src: string, scope: Scope = {}): number | boolean {
  let tokens = cache.get(src);
  if (!tokens) {
    tokens = tokenize(src);
    cache.set(src, tokens);
  }
  return new Parser(tokens, src).parse(scope);
}

/** Evaluate and require a finite number. */
export function evaluateNumber(src: string, scope: Scope = {}): number {
  const v = evaluate(src, scope);
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new ExpressionError(`expression "${src}" did not produce a finite number`);
  }
  return v;
}

/** Evaluate and coerce to boolean (non-zero numbers count as true). */
export function evaluateBoolean(src: string, scope: Scope = {}): boolean {
  return truthy(evaluate(src, scope));
}
