import fs from "node:fs";
import path from "node:path";
import { countRolloutMetadataChanges, updateRolloutMetadata } from "../codex/sessions-jsonl.mjs";
import { updateAutomationDb } from "../codex/automation-db.mjs";
import { updateConfigToml } from "../codex/config-toml.mjs";
import { updateGlobalState } from "../codex/global-state.mjs";
import { codexLocations } from "../codex/locations.mjs";
import { getThreadRows, updateStateDb } from "../codex/state-db.mjs";
import { verifyMigration } from "../codex/verify.mjs";
import { backupFile, backupSqliteFile, createManifest, finalizeManifest, recordFilesystemAction, writeManifest } from "../core/manifest.mjs";
import { printJson, printVerification } from "../core/output.mjs";
import { buildSingleProjectPlan, validatePlanForMove } from "../core/plan.mjs";
import { assertCodexIsClosed } from "../core/process-check.mjs";
import { ensureDir, exists } from "../core/fs.mjs";
import { isInsideOrEqual } from "../core/paths.mjs";
import { requireOption } from "../core/args.mjs";

export function runMigrate(options) {
  requireOption(options, "to", "--to");
  if (!options.project && !options.from) throw new Error("Missing --project or --from.");

  const execute = Boolean(options.execute || process.env.CODEX_WORKSPACE_MIGRATOR_EXECUTE === "1");
  const plan = buildSingleProjectPlan(options);
  validatePlanForMove(plan);
  const locations = codexLocations(options.codexHome);
  const stats = collectMigrationStats({ locations, plan });

  if (!execute) {
    printDryRun(plan, stats, options);
    return;
  }

  runExecuteMigration({ locations, plan, options, stats });
}

function collectMigrationStats({ locations, plan }) {
  const rewrite = plan.pathRewrite;
  const threadRows = getThreadRows(locations.stateDb);
  const relatedThreads = threadRows.filter((row) => isInsideOrEqual(row.cwd, rewrite.from) || isInsideOrEqual(row.cwd, rewrite.exactTo)).length;
  const rollout = countRolloutMetadataChanges(locations, rewrite);
  return {
    relatedThreads,
    rolloutMetadataFiles: rollout.files,
    rolloutMetadataLines: rollout.lines,
    files: {
      config: exists(locations.config),
      globalState: exists(locations.globalState),
      stateDb: exists(locations.stateDb),
      automationDb: exists(locations.automationDb),
      sessionsRoot: exists(locations.sessionsRoot),
    },
  };
}

function printDryRun(plan, stats, options) {
  if (options.json) {
    printJson({ dryRun: true, plan, stats });
    return;
  }

  console.log("Dry run. Pass --execute to apply.");
  console.log(`project: ${plan.project.name}`);
  console.log(`from: ${plan.project.from}`);
  console.log(`to: ${plan.project.to}`);
  if (plan.project.warning) console.log(`warning: ${plan.project.warning}`);
  console.log(`create old-path symlink: ${plan.filesystem.leaveSymlink ? "yes" : "no"}`);
  console.log(`related threads: ${stats.relatedThreads}`);
  console.log(`rollout metadata files to update: ${stats.rolloutMetadataFiles}`);
  console.log(`rollout metadata lines to update: ${stats.rolloutMetadataLines}`);
  console.log(`will update config.toml: ${stats.files.config ? "yes" : "no"}`);
  console.log(`will update global state: ${stats.files.globalState ? "yes" : "no"}`);
  console.log(`will update state_5.sqlite: ${stats.files.stateDb ? "yes" : "no"}`);
  console.log(`will update codex-dev.db: ${stats.files.automationDb ? "yes" : "no"}`);
}

function runExecuteMigration({ locations, plan, options, stats }) {
  assertCodexIsClosed({ force: Boolean(options.forceRunningCodex) });

  const { manifest, manifestPath } = createManifest({
    cwd: process.cwd(),
    command: "migrate",
    plan,
    manifestPath: options.manifest,
  });
  manifest.stats.dryRun = stats;
  writeManifest(manifestPath, manifest);

  try {
    applyFilesystem(plan, manifest, manifestPath);
    updateCodexFiles({ locations, plan, manifest, manifestPath });
    const verification = verifyMigration({ locations, rewrite: plan.pathRewrite });
    finalizeManifest(manifest, manifestPath, { verification });

    console.log(`Manifest: ${manifestPath}`);
    printVerification(verification);
    if (!verification.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    manifest.failed = true;
    manifest.failure = {
      message: error?.message || String(error),
      stack: error?.stack || null,
    };
    writeManifest(manifestPath, manifest);
    throw error;
  }
}

function applyFilesystem(plan, manifest, manifestPath) {
  const from = plan.project.from;
  const to = plan.project.to;
  ensureDir(path.dirname(to));
  fs.renameSync(from, to);
  recordFilesystemAction(manifest, manifestPath, { type: "move", from, to });

  if (plan.filesystem.leaveSymlink) {
    fs.symlinkSync(to, from, "dir");
    recordFilesystemAction(manifest, manifestPath, { type: "symlink", linkPath: from, target: to });
  }
}

function updateCodexFiles({ locations, plan, manifest, manifestPath }) {
  const rewrite = plan.pathRewrite;

  backupFile(manifest, manifestPath, locations.config, "codex-config");
  manifest.stats.config = updateConfigToml(locations.config, rewrite);
  writeManifest(manifestPath, manifest);

  backupFile(manifest, manifestPath, locations.globalState, "codex-global-state");
  manifest.stats.globalState = updateGlobalState(locations.globalState, locations.stateDb, rewrite);
  writeManifest(manifestPath, manifest);

  backupSqliteFile(manifest, manifestPath, locations.stateDb, "codex-state-db");
  manifest.stats.stateDb = updateStateDb(locations.stateDb, rewrite);
  writeManifest(manifestPath, manifest);

  manifest.stats.rolloutMetadata = updateRolloutMetadata(locations, rewrite, (file) => {
    backupFile(manifest, manifestPath, file, "codex-session-jsonl");
  });
  writeManifest(manifestPath, manifest);

  backupSqliteFile(manifest, manifestPath, locations.automationDb, "codex-automation-db");
  manifest.stats.automationDb = updateAutomationDb(locations.automationDb, rewrite);
  writeManifest(manifestPath, manifest);
}
