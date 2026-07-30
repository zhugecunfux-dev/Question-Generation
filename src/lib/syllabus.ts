import fs from "node:fs";
import path from "node:path";
import type { Syllabus, Topic } from "@/lib/types";

let cached: Syllabus | undefined;

/** The 6091 syllabus, loaded from `data/syllabus/6091-physics.json`. */
export function getSyllabus(): Syllabus {
  if (cached) return cached;
  const file = path.join(process.cwd(), "data", "syllabus", "6091-physics.json");
  cached = JSON.parse(fs.readFileSync(file, "utf8")) as Syllabus;
  return cached;
}

export function allTopics(): Topic[] {
  return getSyllabus().sections.flatMap((s) => s.topics);
}

export function findTopic(topicId: string): Topic | undefined {
  return allTopics().find((t) => t.id === topicId);
}

/** Human label, e.g. "T3 — Dynamics". */
export function topicLabel(topicId: string): string {
  const topic = findTopic(topicId);
  return topic ? `${topic.id} — ${topic.title}` : topicId;
}

export function isValidTopicId(topicId: string): boolean {
  return findTopic(topicId) !== undefined;
}
