import { codexLocations } from "../codex/locations.mjs";
import { verifyMigration } from "../codex/verify.mjs";
import { buildSingleProjectPlan } from "../core/plan.mjs";
import { printJson, printVerification } from "../core/output.mjs";
import { buildPathRewrite, expandPath, normalizePath } from "../core/paths.mjs";
import { requireOption } from "../core/args.mjs";

export function runVerify(options) {
  let rewrite;
  let locations;

  if (options.from) {
    const from = normalizePath(expandPath(options.from));
    const to = normalizePath(expandPath(requireOption(options, "to", "--to")));
    rewrite = buildPathRewrite(from, to);
    locations = codexLocations(options.codexHome);
  } else {
    requireOption(options, "project", "--project");
    requireOption(options, "to", "--to");
    const plan = buildSingleProjectPlan(options);
    rewrite = plan.pathRewrite;
    locations = codexLocations(options.codexHome);
  }

  const result = verifyMigration({ locations, rewrite });
  if (options.json) printJson(result);
  else printVerification(result);
  if (!result.ok) process.exitCode = 1;
}

