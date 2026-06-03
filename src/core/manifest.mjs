import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { copyFileWithDirs, ensureDir, exists, sha256, writeJson } from "./fs.mjs";
import { expandPath } from "./paths.mjs";

const MIGRATION_DIR = ".codex-workspace-migration";
const LATEST_MANIFEST_FILE = "latest.json";

export function createManifest({ cwd, command, plan, manifestPath: requestedManifestPath }) {
  const timestamp = formatLocalTimestamp();
  const manifestPath = requestedManifestPath
    ? expandPath(String(requestedManifestPath), cwd)
    : path.join(migrationRoot(cwd), timestamp, "manifest.json");
  if (exists(manifestPath)) throw new Error(`Manifest path already exists: ${manifestPath}`);
  const runDir = path.dirname(manifestPath);
  const backupDir = path.join(runDir, "backups");
  const manifest = {
    version: 1,
    command,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    runDir,
    backupDir,
    plan,
    backups: [],
    filesystemActions: [],
    stats: {},
    completed: false,
  };
  ensureDir(backupDir);
  writeManifest(manifestPath, manifest);
  writeLatestManifest(cwd, manifestPath);
  return { manifest, manifestPath };
}

export function writeManifest(manifestPath, manifest) {
  manifest.updatedAt = new Date().toISOString();
  writeJson(manifestPath, manifest);
}

export function backupFile(manifest, manifestPath, file, label = "file") {
  if (!exists(file)) return null;
  const relativeName = `${manifest.backups.length + 1}-${path.basename(file)}`;
  const backupPath = path.join(manifest.backupDir, relativeName);
  copyFileWithDirs(file, backupPath);
  const record = {
    label,
    originalPath: file,
    backupPath,
    originalSha256: sha256(file),
    backupSha256: sha256(backupPath),
  };
  manifest.backups.push(record);
  writeManifest(manifestPath, manifest);
  return record;
}

export function backupSqliteFile(manifest, manifestPath, file, label = "sqlite") {
  if (!exists(file)) return null;
  const relativeName = `${manifest.backups.length + 1}-${path.basename(file)}`;
  const backupPath = path.join(manifest.backupDir, relativeName);
  ensureDir(path.dirname(backupPath));
  execFileSync("sqlite3", [file, `.backup ${JSON.stringify(backupPath)}`], { stdio: "ignore" });
  const record = {
    label,
    originalPath: file,
    backupPath,
    originalSha256: sha256(file),
    backupSha256: sha256(backupPath),
  };
  manifest.backups.push(record);
  writeManifest(manifestPath, manifest);
  return record;
}

export function recordFilesystemAction(manifest, manifestPath, action) {
  manifest.filesystemActions.push({ ...action, recordedAt: new Date().toISOString() });
  writeManifest(manifestPath, manifest);
}

export function finalizeManifest(manifest, manifestPath, stats = {}) {
  manifest.stats = { ...manifest.stats, ...stats };
  manifest.completed = true;
  writeManifest(manifestPath, manifest);
}

export function readManifest(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function resolveManifestPath(options, cwd = process.cwd()) {
  if (options.manifest && options.manifest !== true) {
    return expandPath(String(options.manifest), cwd);
  }

  const latest = readLatestManifest(cwd);
  if (latest) return latest;

  const scanned = scanLatestManifest(cwd);
  if (scanned) return scanned;

  throw new Error(`Missing --manifest and no default manifest was found under ${migrationRoot(cwd)}`);
}

function writeLatestManifest(cwd, manifestPath) {
  const latestPath = latestManifestPath(cwd);
  ensureDir(path.dirname(latestPath));
  writeJson(latestPath, {
    version: 1,
    manifestPath,
    updatedAt: new Date().toISOString(),
  });
}

function readLatestManifest(cwd) {
  const latestPath = latestManifestPath(cwd);
  if (!exists(latestPath)) return null;
  const latest = readManifest(latestPath);
  const manifestPath = latest?.manifestPath ? String(latest.manifestPath) : null;
  return manifestPath && exists(manifestPath) ? manifestPath : null;
}

function scanLatestManifest(cwd) {
  const root = migrationRoot(cwd);
  if (!exists(root)) return null;
  const candidates = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(root, entry.name, "manifest.json");
    if (!exists(manifestPath)) continue;
    candidates.push({ manifestPath, mtimeMs: fs.statSync(manifestPath).mtimeMs });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || b.manifestPath.localeCompare(a.manifestPath));
  return candidates[0]?.manifestPath || null;
}

function migrationRoot(cwd) {
  return path.join(cwd, MIGRATION_DIR);
}

function latestManifestPath(cwd) {
  return path.join(migrationRoot(cwd), LATEST_MANIFEST_FILE);
}

export function formatLocalTimestamp(date = new Date()) {
  const offsetMinutes = date.getTimezoneOffset();
  const sign = offsetMinutes <= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offsetMinutes);
  const offsetHours = Math.floor(absoluteOffset / 60);
  const offsetRemainderMinutes = absoluteOffset % 60;

  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `T${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`,
    `-${pad(date.getMilliseconds(), 3)}${sign}${pad(offsetHours)}-${pad(offsetRemainderMinutes)}`,
  ].join("");
}

function pad(value, width = 2) {
  return String(value).padStart(width, "0");
}
