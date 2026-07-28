// Core domain types for the 6091 question bank + generator.

export type QuestionFormat = "mcq" | "structured" | "data_based" | "free_response" | "practical";

export type Difficulty = "easy" | "medium" | "hard";

/** Assessment objective. AO3 is practical-only (Paper 3). */
export type AO = "AO1" | "AO2" | "AO3";

export interface Subtopic {
  id: string;
  title: string;
}

export interface Topic {
  id: string;
  number: number;
  title: string;
  subtopics: Subtopic[];
  syllabusNote?: string;
  keyQuantities?: string[];
}

export interface Section {
  id: string;
  title: string;
  topics: Topic[];
}

export interface PaperStructure {
  section: string | null;
  marks: number;
  questionCount?: number;
  compulsory?: boolean;
  choice?: string;
  description: string;
}

export interface Paper {
  id: string;
  code: string;
  name: string;
  durationMinutes: number;
  marks: number;
  weighting: number;
  questionFormats: QuestionFormat[];
  structure: PaperStructure[];
}

export interface Syllabus {
  id: string;
  subject: string;
  subjectCode: string;
  qualification: string;
  syllabusYear: number;
  sourceDocument: { title: string; url: string; mirror?: string; verified: boolean; note?: string };
  assessmentObjectives: Array<{
    id: AO;
    title: string;
    description: string;
    theoryWeighting?: number;
    notes?: string;
    assessedIn?: string[];
    skillAreas?: Array<{ id: string; title: string; weightingWithinPaper3?: number }>;
  }>;
  papers: Paper[];
  sections: Section[];
}

// ---------------------------------------------------------------------------
// Question bank
// ---------------------------------------------------------------------------

export interface McqOption {
  label: string; // "A" | "B" | ...
  text: string;
  correct: boolean;
}

/**
 * A concrete question. `kind: "static"` is a fixed question as authored /
 * imported; `kind: "template"` carries a parameterised recipe that the variant
 * engine expands into many concrete questions.
 */
export interface QuestionBase {
  id: string;
  /** Where it came from: "import", "seed", "template:<templateId>", "llm". */
  source: string;
  topicId: string;
  subtopicId?: string;
  format: QuestionFormat;
  difficulty: Difficulty;
  ao: AO;
  marks: number;
  /** Question text. May contain LaTeX between `$...$`. */
  stem: string;
  /** Present for `format: "mcq"`. */
  options?: McqOption[];
  /** Expected answer (final value / key points). */
  answer: string;
  /** Worked solution or mark scheme. */
  solution?: string;
  /** Free-form tags: "TYS2019", "calculator", "graph", ... */
  tags: string[];
  createdAt: string;
}

export interface Question extends QuestionBase {
  kind: "static";
}

// --- Template (parameterised variant) questions ---------------------------

export type VariableSpec =
  | { name: string; type: "int"; min: number; max: number; step?: number }
  | { name: string; type: "float"; min: number; max: number; decimals?: number }
  | { name: string; type: "choice"; values: Array<string | number> };

export interface DerivedSpec {
  name: string;
  /** Arithmetic expression over variables + earlier derived values. */
  expr: string;
  /** Round the computed value to this many decimal places when rendering. */
  decimals?: number;
  /** Or round to this many significant figures when rendering. */
  sigfig?: number;
}

export interface TemplateOptionSpec {
  /** Expression evaluated to produce the option value. */
  expr: string;
  correct?: boolean;
  /** Optional text template; if absent the numeric value + unit is used. */
  text?: string;
}

export interface QuestionTemplate {
  kind: "template";
  id: string;
  source: string;
  topicId: string;
  subtopicId?: string;
  format: QuestionFormat;
  difficulty: Difficulty;
  ao: AO;
  marks: number;
  /** Mustache-ish stem, e.g. "A car accelerates from {{u}} m/s ...". */
  stem: string;
  variables: VariableSpec[];
  /** Boolean expressions that a sampled variable set must satisfy. */
  constraints?: string[];
  derived?: DerivedSpec[];
  /** Which derived/variable name is the answer, plus its unit. */
  answer: { value: string; unit?: string; decimals?: number; sigfig?: number };
  /** Templated worked solution. */
  solution?: string;
  /** For MCQ templates: the correct option plus distractor expressions. */
  options?: TemplateOptionSpec[];
  tags: string[];
  createdAt: string;
}

export type BankEntry = Question | QuestionTemplate;

// ---------------------------------------------------------------------------
// Paper generation
// ---------------------------------------------------------------------------

export interface BlueprintSlot {
  topicIds?: string[];
  format?: QuestionFormat;
  difficulty?: Difficulty;
  ao?: AO;
  count: number;
}

export interface GenerateRequest {
  /** "retrieve" = pick from bank; "template" = expand template variants; "llm" = model-authored. */
  mode: "retrieve" | "template" | "llm";
  paperId?: string;
  topicIds: string[];
  formats?: QuestionFormat[];
  difficulties?: Difficulty[];
  count: number;
  /** Deterministic sampling seed for template mode. */
  seed?: number;
  /** Extra instruction passed to the model in llm mode. */
  notes?: string;
}

export interface GeneratedPaper {
  mode: GenerateRequest["mode"];
  generatedAt: string;
  seed?: number;
  totalMarks: number;
  questions: Question[];
  /** Warnings, e.g. "asked for 12 MCQ on T3, bank only had 5". */
  warnings: string[];
}
