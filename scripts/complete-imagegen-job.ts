#!/usr/bin/env tsx

import {
  completeImagegenJob,
  failImagegenJob,
} from "@/lib/imagegen-jobs.server";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const jobPath = argument("--job");
const baseImagePath = argument("--base");
const failureReason = argument("--fail");

if (!jobPath || (!baseImagePath && !failureReason)) {
  console.error(
    "Usage: npm run imagegen:complete -- --job generated/<paper>/<question>.imagegen.json (--base /absolute/path/to/generated-image.png | --fail \"reason\")",
  );
  process.exitCode = 2;
} else {
  try {
    const job = failureReason
      ? failImagegenJob(jobPath, failureReason)
      : await completeImagegenJob(jobPath, baseImagePath!);
    console.log(`status: ${job.status}`);
    console.log(`job:    ${jobPath}`);
    console.log(`output: ${job.outputPath}`);
    console.log(`base:   ${job.basePath}`);
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : String(cause));
    process.exitCode = 1;
  }
}
