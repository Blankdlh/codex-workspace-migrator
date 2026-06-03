import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const PACKAGE = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));

test("packed npm tarball exposes the CLI binary", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cwm package smoke-"));
  const packDir = path.join(root, "pack");
  const installDir = path.join(root, "install");
  const cacheDir = path.join(root, "npm-cache");
  fs.mkdirSync(packDir, { recursive: true });
  fs.mkdirSync(installDir, { recursive: true });

  const packOutput = execFileSync(
    "npm",
    ["pack", REPO_ROOT, "--pack-destination", packDir, "--cache", cacheDir, "--json", "--dry-run=false"],
    { cwd: root, encoding: "utf8" },
  );
  const packed = JSON.parse(packOutput);
  const tarball = path.join(packDir, packed[0].filename);
  assert.equal(fs.existsSync(tarball), true);

  execFileSync(
    "npm",
    [
      "install",
      "--prefix",
      installDir,
      "--cache",
      cacheDir,
      "--ignore-scripts",
      "--no-audit",
      "--fund=false",
      "--dry-run=false",
      tarball,
    ],
    { cwd: root, encoding: "utf8" },
  );

  const bin = path.join(
    installDir,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "codex-workspace-migrator.cmd" : "codex-workspace-migrator",
  );
  const result = spawnSync(bin, ["--help"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /codex-workspace-migrator/);
  assert.match(result.stdout, /migrate/);

  const version = spawnSync(bin, ["--version"], { cwd: root, encoding: "utf8" });
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), PACKAGE.version);
});
