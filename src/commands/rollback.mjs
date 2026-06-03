import fs from "node:fs";
import { copyFileWithDirs, exists, sha256 } from "../core/fs.mjs";
import { readManifest, resolveManifestPath } from "../core/manifest.mjs";

export function runRollback(options) {
  const manifestPath = resolveManifestPath(options);
  const manifest = readManifest(manifestPath);
  const execute = Boolean(options.execute || process.env.CODEX_WORKSPACE_MIGRATOR_EXECUTE === "1");

  if (!execute) {
    console.log("Dry run rollback. Pass --execute to apply.");
    console.log(`manifest: ${manifestPath}`);
    printRollbackPlan(manifest);
    return;
  }

  preflightRollback(manifest);

  for (const backup of [...(manifest.backups || [])].reverse()) {
    copyFileWithDirs(backup.backupPath, backup.originalPath);
  }

  for (const action of filesystemActionsForRollback(manifest).reverse()) {
    if (action.type === "symlink") rollbackSymlink(action);
    if (action.type === "move") rollbackMove(action);
  }

  console.log(`Rolled back migration from manifest: ${manifestPath}`);
}

function preflightRollback(manifest) {
  for (const backup of manifest.backups || []) {
    preflightBackup(backup);
  }

  const removedPaths = new Set();
  for (const action of filesystemActionsForRollback(manifest).reverse()) {
    if (action.type === "symlink") {
      preflightSymlinkRollback(action);
      if (exists(action.linkPath)) removedPaths.add(action.linkPath);
    }
    if (action.type === "move") {
      preflightMoveRollback(action, removedPaths);
    }
  }
}

function preflightBackup(backup) {
  if (!exists(backup.backupPath)) throw new Error(`Missing backup: ${backup.backupPath}`);
  if (!backup.backupSha256) return;
  const actual = sha256(backup.backupPath);
  if (actual !== backup.backupSha256) {
    throw new Error(`Backup checksum mismatch: ${backup.backupPath}`);
  }
}

function printRollbackPlan(manifest) {
  console.log(`backups to restore: ${(manifest.backups || []).length}`);
  const actions = filesystemActionsForRollback(manifest);
  console.log(`filesystem actions to reverse: ${actions.length}`);
  for (const action of actions) {
    console.log(`  ${action.type}: ${action.from || action.linkPath} -> ${action.to || action.target}`);
  }
}

function filesystemActionsForRollback(manifest) {
  const actions = [...(manifest.filesystemActions || [])];
  const hasMove = actions.some((action) => action.type === "move");
  const hasSymlink = actions.some((action) => action.type === "symlink");
  const plan = manifest.plan;

  if (plan?.project?.from && plan?.project?.to) {
    if (!hasMove) {
      actions.push({
        type: "move",
        from: plan.project.from,
        to: plan.project.to,
        inferredFromPlan: true,
      });
    }
    if (plan.filesystem?.leaveSymlink && !hasSymlink) {
      actions.push({
        type: "symlink",
        linkPath: plan.project.from,
        target: plan.project.to,
        inferredFromPlan: true,
      });
    }
  }

  return actions;
}

function rollbackSymlink(action) {
  if (!exists(action.linkPath)) return;
  const stat = fs.lstatSync(action.linkPath);
  if (!stat.isSymbolicLink()) {
    throw new Error(`Refusing to remove non-symlink rollback path: ${action.linkPath}`);
  }
  const target = fs.readlinkSync(action.linkPath);
  if (target !== action.target) {
    throw new Error(`Refusing to remove symlink with unexpected target: ${action.linkPath} -> ${target}`);
  }
  fs.unlinkSync(action.linkPath);
}

function rollbackMove(action) {
  if (exists(action.from)) {
    throw new Error(`Refusing to move back because source path already exists: ${action.from}`);
  }
  if (!exists(action.to)) {
    throw new Error(`Cannot roll back moved directory because target is missing: ${action.to}`);
  }
  fs.renameSync(action.to, action.from);
}

function preflightSymlinkRollback(action) {
  if (!exists(action.linkPath)) return;
  const stat = fs.lstatSync(action.linkPath);
  if (!stat.isSymbolicLink()) {
    throw new Error(`Refusing to remove non-symlink rollback path: ${action.linkPath}`);
  }
  const target = fs.readlinkSync(action.linkPath);
  if (target !== action.target) {
    throw new Error(`Refusing to remove symlink with unexpected target: ${action.linkPath} -> ${target}`);
  }
}

function preflightMoveRollback(action, removedPaths) {
  if (exists(action.from) && !removedPaths.has(action.from)) {
    throw new Error(`Refusing to move back because source path already exists: ${action.from}`);
  }
  if (!exists(action.to)) {
    throw new Error(`Cannot roll back moved directory because target is missing: ${action.to}`);
  }
}
