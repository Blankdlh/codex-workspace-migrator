import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { isCodexBlockingProcess } from "../src/core/process-check.mjs";
import { formatLocalTimestamp } from "../src/core/manifest.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const CLI = path.join(REPO_ROOT, "src", "cli.mjs");
const PACKAGE = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));

test("dry-run migrate resolves one project and does not write", () => {
  const fixture = createFixture();
  const result = runCli(
    [
      "migrate",
      "--project",
      "My App",
      "--to",
      fixture.newProject,
      "--codex-home",
      fixture.codexHome,
    ],
    fixture.root,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Dry run/);
  assert.match(result.stdout, /related threads: 1/);
  assert.match(result.stdout, /rollout metadata lines to update: 2/);
  assert.equal(fs.existsSync(fixture.oldProject), true);
  assert.equal(fs.existsSync(fixture.newProject), false);
  assert.equal(fs.existsSync(path.join(fixture.root, ".codex-workspace-migration")), false);
});

test("help is available for top-level and all commands", () => {
  const cases = [
    { args: ["--help"], expected: [/Usage:/, /migrate/] },
    { args: ["list", "--help"], expected: [/codex-workspace-migrator list/, /--json/] },
    { args: ["migrate", "--help"], expected: [/--project <name>/, /--manifest <path>/, /--execute/] },
    { args: ["verify", "--help"], expected: [/--from <path>/, /--to <path>/] },
    { args: ["doctor", "--help"], expected: [/codex-workspace-migrator doctor/, /--codex-home <path>/] },
    { args: ["rollback", "--help"], expected: [/--manifest <path>/, /--execute/] },
  ];

  for (const testCase of cases) {
    const result = runCli(testCase.args, REPO_ROOT);
    assert.equal(result.status, 0, result.stderr);
    for (const pattern of testCase.expected) assert.match(result.stdout, pattern);
  }
});

test("version is available from the CLI", () => {
  for (const args of [["--version"], ["-v"], ["version"]]) {
    const result = runCli(args, REPO_ROOT);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), PACKAGE.version);
  }
});

test("Codex process detection ignores crashpad handlers", () => {
  assert.equal(
    isCodexBlockingProcess(
      "1364 /Applications/Codex.app/Contents/Frameworks/Codex Framework.framework/Versions/148.0.7778.179/Helpers/browser_crashpad_handler --monitor-self",
    ),
    false,
  );
  assert.equal(
    isCodexBlockingProcess("68179 /Applications/Codex.app/Contents/MacOS/Codex"),
    true,
  );
  assert.equal(
    isCodexBlockingProcess("66820 /Applications/Codex.app/Contents/Resources/codex app-server --listen stdio://"),
    true,
  );
});

test("manifest timestamp uses local timezone offset", () => {
  const date = new Date(2026, 5, 3, 14, 29, 38, 59);
  assert.equal(formatLocalTimestamp(date), `2026-06-03T14-29-38-059${localOffsetFor(date)}`);
});

test("list --json returns known Codex projects", () => {
  const fixture = createFixture();
  const result = runCli(["list", "--codex-home", fixture.codexHome, "--json"], fixture.root);

  assert.equal(result.status, 0, result.stderr);
  const projects = JSON.parse(result.stdout);
  const project = projects.find((candidate) => candidate.path === fixture.oldProject);
  assert.ok(project, result.stdout);
  assert.equal(project.name, "My App");
  assert.equal(project.exists, true);
  assert.deepEqual(project.sources, [
    "config",
    "global-state:project-order",
    "global-state:saved-root",
    "global-state:thread-assignment",
  ]);
  assert.equal(projects.some((candidate) => candidate.path === path.join(fixture.oldProject, "src") && candidate.sources.includes("state-db:threads")), true);
});

test("dry-run refuses an existing target path", () => {
  const fixture = createFixture();
  fs.mkdirSync(fixture.newProject, { recursive: true });
  const result = runCli(
    [
      "migrate",
      "--project",
      "My App",
      "--to",
      fixture.newProject,
      "--codex-home",
      fixture.codexHome,
    ],
    fixture.root,
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Target project path already exists/);
});

test("dry-run refuses a target path inside the source project", () => {
  const fixture = createFixture();
  const result = runCli(
    [
      "migrate",
      "--project",
      "My App",
      "--to",
      path.join(fixture.oldProject, "nested-target"),
      "--codex-home",
      fixture.codexHome,
    ],
    fixture.root,
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cannot be inside the source project path/);
});

test("execute migrate updates Codex state and preserves chat text", () => {
  const fixture = createFixture();
  const result = runCli(
    [
      "migrate",
      "--project",
      "My App",
      "--to",
      fixture.newProject,
      "--codex-home",
      fixture.codexHome,
      "--execute",
    ],
    fixture.root,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Manifest:/);
  assert.equal(fs.lstatSync(fixture.oldProject).isSymbolicLink(), true);
  assert.equal(fs.readlinkSync(fixture.oldProject), fixture.newProject);
  assert.equal(fs.existsSync(path.join(fixture.newProject, "app.txt")), true);

  const config = fs.readFileSync(path.join(fixture.codexHome, "config.toml"), "utf8");
  assert.equal(config.includes(fixture.oldProject), false);
  assert.equal(config.includes(fixture.newProject), true);

  const globalState = JSON.parse(fs.readFileSync(path.join(fixture.codexHome, ".codex-global-state.json"), "utf8"));
  assert.deepEqual(globalState["electron-saved-workspace-roots"], [fixture.newProject]);
  assert.equal(globalState["thread-project-assignments"]["thread-1"].path, fixture.newProject);
  assert.deepEqual(globalState["projectless-thread-ids"], ["other"]);
  assert.deepEqual(globalState["some-array"], [
    "dup",
    "dup",
    path.join(fixture.newProject, "src"),
    path.join(fixture.newProject, "src"),
  ]);

  const threadRows = sqliteJson(
    path.join(fixture.codexHome, "state_5.sqlite"),
    "select id, cwd, thread_source, has_user_event, first_user_message, preview from threads;",
  );
  assert.deepEqual(threadRows, [
    {
      id: "thread-1",
      cwd: fixture.newProject,
      thread_source: "user",
      has_user_event: 1,
      first_user_message: "hello",
      preview: "hello",
    },
  ]);

  const sessionRecords = readJsonl(fixture.sessionFile);
  assert.equal(sessionRecords[0].payload.cwd, path.join(fixture.newProject, "src"));
  assert.equal(sessionRecords[1].payload.cwd, path.join(fixture.newProject, "src"));
  assert.equal(sessionRecords[1].payload.sandbox_policy.cwd, path.join(fixture.newProject, "src"));
  assert.equal(sessionRecords[2].payload.message, `Keep original text ${fixture.oldProject}/src`);

  const verify = runCli(
    [
      "verify",
      "--from",
      fixture.oldProject,
      "--to",
      fixture.newProject,
      "--codex-home",
      fixture.codexHome,
    ],
    fixture.root,
  );
  assert.equal(verify.status, 0, verify.stderr);
  assert.match(verify.stdout, /ok: yes/);
});

test("verify ignores unrelated invisible user rows", () => {
  const fixture = createFixture();
  const migrate = runCli(
    [
      "migrate",
      "--project",
      "My App",
      "--to",
      fixture.newProject,
      "--codex-home",
      fixture.codexHome,
      "--execute",
    ],
    fixture.root,
  );
  assert.equal(migrate.status, 0, migrate.stderr);

  execFileSync("sqlite3", [
    path.join(fixture.codexHome, "state_5.sqlite"),
    `insert into threads values (${q("unrelated")}, ${q(path.join(fixture.root, "Other App"))}, null, ${q("cli")}, null, 1, ${q("Other project")}, ${q("Other project")}, ${q("Other project")}, null);`,
  ]);

  const verify = runCli(
    [
      "verify",
      "--from",
      fixture.oldProject,
      "--to",
      fixture.newProject,
      "--codex-home",
      fixture.codexHome,
    ],
    fixture.root,
  );
  assert.equal(verify.status, 0, verify.stderr);
  assert.match(verify.stdout, /state_5.sqlite invisible user rows remaining: 0/);
  assert.match(verify.stdout, /ok: yes/);
});

test("execute migrate treats SQL wildcard path characters literally", () => {
  const fixture = createFixture({ projectName: "My %_ App" });
  const target = `${fixture.oldProject} Moved`;
  const result = runCli(
    [
      "migrate",
      "--project",
      "My %_ App",
      "--to",
      target,
      "--codex-home",
      fixture.codexHome,
      "--execute",
    ],
    fixture.root,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readlinkSync(fixture.oldProject), target);

  const stateRows = sqliteJson(path.join(fixture.codexHome, "state_5.sqlite"), "select cwd, sandbox_policy from threads;");
  assert.deepEqual(stateRows, [
    {
      cwd: target,
      sandbox_policy: JSON.stringify({ cwd: path.join(target, "src") }),
    },
  ]);

  const automationRows = sqliteJson(
    path.join(fixture.codexHome, "sqlite", "codex-dev.db"),
    "select prompt, cwds from automations;",
  );
  assert.deepEqual(automationRows, [
    {
      prompt: `Run in ${path.join(target, "src")}`,
      cwds: path.join(target, "src"),
    },
  ]);

  const verify = runCli(
    [
      "verify",
      "--from",
      fixture.oldProject,
      "--to",
      target,
      "--codex-home",
      fixture.codexHome,
    ],
    fixture.root,
  );
  assert.equal(verify.status, 0, verify.stderr);
  assert.match(verify.stdout, /ok: yes/);
});

test("migrate handles TOML-escaped project section paths", () => {
  const fixture = createFixture({ projectName: 'My "Quoted" App' });
  const result = runCli(
    [
      "migrate",
      "--project",
      'My "Quoted" App',
      "--to",
      fixture.newProject,
      "--codex-home",
      fixture.codexHome,
      "--execute",
    ],
    fixture.root,
  );

  assert.equal(result.status, 0, result.stderr);
  const config = fs.readFileSync(path.join(fixture.codexHome, "config.toml"), "utf8");
  assert.equal(config.includes(`[projects.${tomlString(fixture.newProject)}]`), true);
  assert.equal(config.includes(`[projects.${tomlString(fixture.oldProject)}]`), false);
  const verify = runCli(
    [
      "verify",
      "--from",
      fixture.oldProject,
      "--to",
      fixture.newProject,
      "--codex-home",
      fixture.codexHome,
    ],
    fixture.root,
  );
  assert.equal(verify.status, 0, verify.stderr);
});

test("verify fails when old path is a normal directory instead of missing or symlink", () => {
  const fixture = createFixture();
  const migrate = runCli(
    [
      "migrate",
      "--project",
      "My App",
      "--to",
      fixture.newProject,
      "--codex-home",
      fixture.codexHome,
      "--execute",
    ],
    fixture.root,
  );
  assert.equal(migrate.status, 0, migrate.stderr);
  fs.unlinkSync(fixture.oldProject);
  fs.mkdirSync(fixture.oldProject);

  const verify = runCli(
    [
      "verify",
      "--from",
      fixture.oldProject,
      "--to",
      fixture.newProject,
      "--codex-home",
      fixture.codexHome,
    ],
    fixture.root,
  );
  assert.notEqual(verify.status, 0);
  assert.match(verify.stdout, /old path acceptable: no/);
  assert.match(verify.stdout, /ok: no/);
});

test("verify checks all migrated automation DB path columns", () => {
  const fixture = createFixture();
  const migrate = runCli(
    [
      "migrate",
      "--project",
      "My App",
      "--to",
      fixture.newProject,
      "--codex-home",
      fixture.codexHome,
      "--execute",
    ],
    fixture.root,
  );
  assert.equal(migrate.status, 0, migrate.stderr);

  execFileSync("sqlite3", [
    path.join(fixture.codexHome, "sqlite", "codex-dev.db"),
    `update automations set prompt = ${q(`Run in ${path.join(fixture.oldProject, "src")}`)};`,
  ]);

  const verify = runCli(
    [
      "verify",
      "--from",
      fixture.oldProject,
      "--to",
      fixture.newProject,
      "--codex-home",
      fixture.codexHome,
    ],
    fixture.root,
  );

  assert.notEqual(verify.status, 0);
  assert.match(verify.stdout, /codex-dev\.db automation old path rows remaining: 1/);
  assert.match(verify.stdout, /ok: no/);
});

test("rollback restores files, databases, jsonl, and filesystem move", () => {
  const fixture = createFixture();
  const migrate = runCli(
    [
      "migrate",
      "--project",
      "My App",
      "--to",
      fixture.newProject,
      "--codex-home",
      fixture.codexHome,
      "--execute",
    ],
    fixture.root,
  );
  assert.equal(migrate.status, 0, migrate.stderr);
  const manifestPath = migrate.stdout.match(/Manifest: (.+)/)?.[1]?.trim();
  assert.ok(manifestPath, migrate.stdout);
  fs.unlinkSync(path.join(fixture.root, ".codex-workspace-migration", "latest.json"));

  const rollbackDryRun = runCli(["rollback"], fixture.root);
  assert.equal(rollbackDryRun.status, 0, rollbackDryRun.stderr);
  assert.match(rollbackDryRun.stdout, /Dry run rollback/);
  assert.match(rollbackDryRun.stdout, new RegExp(escapeRegExp(`manifest: ${manifestPath}`)));

  const rollback = runCli(["rollback", "--execute"], fixture.root);
  assert.equal(rollback.status, 0, rollback.stderr);

  assert.equal(fs.existsSync(fixture.newProject), false);
  assert.equal(fs.lstatSync(fixture.oldProject).isSymbolicLink(), false);
  assert.equal(fs.existsSync(path.join(fixture.oldProject, "app.txt")), true);

  const config = fs.readFileSync(path.join(fixture.codexHome, "config.toml"), "utf8");
  assert.equal(config.includes(fixture.oldProject), true);
  assert.equal(config.includes(fixture.newProject), false);

  const threadRows = sqliteJson(
    path.join(fixture.codexHome, "state_5.sqlite"),
    "select id, cwd, thread_source, has_user_event, first_user_message, preview from threads;",
  );
  assert.deepEqual(threadRows, [
    {
      id: "thread-1",
      cwd: path.join(fixture.oldProject, "src"),
      thread_source: "",
      has_user_event: 0,
      first_user_message: "",
      preview: "hello",
    },
  ]);

  const sessionRecords = readJsonl(fixture.sessionFile);
  assert.equal(sessionRecords[0].payload.cwd, path.join(fixture.oldProject, "src"));
  assert.equal(sessionRecords[2].payload.message, `Keep original text ${fixture.oldProject}/src`);
});

test("migrate supports custom manifest path and updates default rollback pointer", () => {
  const fixture = createFixture();
  const customManifest = path.join(fixture.root, "audit", "custom-manifest.json");
  const migrate = runCli(
    [
      "migrate",
      "--project",
      "My App",
      "--to",
      fixture.newProject,
      "--codex-home",
      fixture.codexHome,
      "--manifest",
      customManifest,
      "--execute",
    ],
    fixture.root,
  );
  assert.equal(migrate.status, 0, migrate.stderr);
  assert.match(migrate.stdout, new RegExp(escapeRegExp(`Manifest: ${customManifest}`)));

  const manifest = JSON.parse(fs.readFileSync(customManifest, "utf8"));
  assert.equal(manifest.backupDir, path.join(path.dirname(customManifest), "backups"));
  assert.equal(fs.existsSync(path.join(fixture.root, ".codex-workspace-migration", "latest.json")), true);

  const rollbackDryRun = runCli(["rollback"], fixture.root);
  assert.equal(rollbackDryRun.status, 0, rollbackDryRun.stderr);
  assert.match(rollbackDryRun.stdout, new RegExp(escapeRegExp(`manifest: ${customManifest}`)));

  const rollbackExplicit = runCli(["rollback", "--manifest", customManifest], fixture.root);
  assert.equal(rollbackExplicit.status, 0, rollbackExplicit.stderr);
  assert.match(rollbackExplicit.stdout, new RegExp(escapeRegExp(`manifest: ${customManifest}`)));
});

test("rollback works when migration does not leave an old-path symlink", () => {
  const fixture = createFixture();
  const migrate = runCli(
    [
      "migrate",
      "--project",
      "My App",
      "--to",
      fixture.newProject,
      "--codex-home",
      fixture.codexHome,
      "--no-symlink",
      "--execute",
    ],
    fixture.root,
  );
  assert.equal(migrate.status, 0, migrate.stderr);
  assert.equal(fs.existsSync(fixture.oldProject), false);
  assert.equal(fs.existsSync(fixture.newProject), true);

  const manifestPath = migrate.stdout.match(/Manifest: (.+)/)?.[1]?.trim();
  assert.ok(manifestPath, migrate.stdout);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.completed, true);
  assert.deepEqual(manifest.filesystemActions.map((action) => action.type), ["move"]);

  const rollback = runCli(["rollback", "--manifest", manifestPath, "--execute"], fixture.root);
  assert.equal(rollback.status, 0, rollback.stderr);
  assert.equal(fs.existsSync(fixture.newProject), false);
  assert.equal(fs.lstatSync(fixture.oldProject).isSymbolicLink(), false);
  assert.equal(fs.existsSync(path.join(fixture.oldProject, "app.txt")), true);
});

test("rollback handles SQL wildcard path characters and target-prefix paths", () => {
  const fixture = createFixture({ projectName: "My %_ App" });
  const target = `${fixture.oldProject} Moved`;
  const migrate = runCli(
    [
      "migrate",
      "--project",
      "My %_ App",
      "--to",
      target,
      "--codex-home",
      fixture.codexHome,
      "--execute",
    ],
    fixture.root,
  );
  assert.equal(migrate.status, 0, migrate.stderr);
  const manifestPath = migrate.stdout.match(/Manifest: (.+)/)?.[1]?.trim();
  assert.ok(manifestPath, migrate.stdout);

  const rollback = runCli(["rollback", "--manifest", manifestPath, "--execute"], fixture.root);
  assert.equal(rollback.status, 0, rollback.stderr);
  assert.equal(fs.existsSync(target), false);
  assert.equal(fs.lstatSync(fixture.oldProject).isSymbolicLink(), false);
  assert.equal(fs.existsSync(path.join(fixture.oldProject, "app.txt")), true);

  const config = fs.readFileSync(path.join(fixture.codexHome, "config.toml"), "utf8");
  assert.equal(config.includes(fixture.oldProject), true);
  assert.equal(config.includes(target), false);

  const stateRows = sqliteJson(path.join(fixture.codexHome, "state_5.sqlite"), "select cwd, sandbox_policy from threads;");
  assert.deepEqual(stateRows, [
    {
      cwd: path.join(fixture.oldProject, "src"),
      sandbox_policy: JSON.stringify({ cwd: path.join(fixture.oldProject, "src") }),
    },
  ]);
});

test("rollback can infer filesystem actions from manifest plan", () => {
  const fixture = createFixture();
  const migrate = runCli(
    [
      "migrate",
      "--project",
      "My App",
      "--to",
      fixture.newProject,
      "--codex-home",
      fixture.codexHome,
      "--execute",
    ],
    fixture.root,
  );
  assert.equal(migrate.status, 0, migrate.stderr);
  const manifestPath = migrate.stdout.match(/Manifest: (.+)/)?.[1]?.trim();
  assert.ok(manifestPath, migrate.stdout);

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.filesystemActions = [];
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const rollback = runCli(["rollback", "--manifest", manifestPath, "--execute"], fixture.root);
  assert.equal(rollback.status, 0, rollback.stderr);
  assert.equal(fs.existsSync(fixture.newProject), false);
  assert.equal(fs.lstatSync(fixture.oldProject).isSymbolicLink(), false);
  assert.equal(fs.existsSync(path.join(fixture.oldProject, "app.txt")), true);
});

test("rollback preflight refuses corrupted backups before restoring anything", () => {
  const fixture = createFixture();
  const migrate = runCli(
    [
      "migrate",
      "--project",
      "My App",
      "--to",
      fixture.newProject,
      "--codex-home",
      fixture.codexHome,
      "--execute",
    ],
    fixture.root,
  );
  assert.equal(migrate.status, 0, migrate.stderr);
  const manifestPath = migrate.stdout.match(/Manifest: (.+)/)?.[1]?.trim();
  assert.ok(manifestPath, migrate.stdout);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.ok(manifest.backups?.[0]?.backupPath, manifestPath);

  fs.writeFileSync(manifest.backups[0].backupPath, "corrupted backup\n");
  const configBefore = fs.readFileSync(path.join(fixture.codexHome, "config.toml"), "utf8");
  assert.equal(configBefore.includes(fixture.newProject), true);

  const rollback = runCli(["rollback", "--manifest", manifestPath, "--execute"], fixture.root);
  assert.notEqual(rollback.status, 0);
  assert.match(rollback.stderr, /Backup checksum mismatch/);

  const configAfter = fs.readFileSync(path.join(fixture.codexHome, "config.toml"), "utf8");
  assert.equal(configAfter, configBefore);
  assert.equal(fs.existsSync(fixture.newProject), true);
  assert.equal(fs.lstatSync(fixture.oldProject).isSymbolicLink(), true);
});

test("rollback preflight refuses unsafe filesystem state before restoring backups", () => {
  const fixture = createFixture();
  const migrate = runCli(
    [
      "migrate",
      "--project",
      "My App",
      "--to",
      fixture.newProject,
      "--codex-home",
      fixture.codexHome,
      "--execute",
    ],
    fixture.root,
  );
  assert.equal(migrate.status, 0, migrate.stderr);
  const manifestPath = migrate.stdout.match(/Manifest: (.+)/)?.[1]?.trim();
  assert.ok(manifestPath, migrate.stdout);

  fs.unlinkSync(fixture.oldProject);
  fs.mkdirSync(fixture.oldProject);
  const configBefore = fs.readFileSync(path.join(fixture.codexHome, "config.toml"), "utf8");
  assert.equal(configBefore.includes(fixture.newProject), true);

  const rollback = runCli(["rollback", "--manifest", manifestPath, "--execute"], fixture.root);
  assert.notEqual(rollback.status, 0);
  assert.match(rollback.stderr, /Refusing to remove non-symlink rollback path/);

  const configAfter = fs.readFileSync(path.join(fixture.codexHome, "config.toml"), "utf8");
  assert.equal(configAfter, configBefore);
  assert.equal(fs.existsSync(fixture.newProject), true);
  assert.equal(fs.lstatSync(fixture.oldProject).isDirectory(), true);
});

test("ambiguous project names require --from", () => {
  const fixture = createFixture({ duplicateProject: true });
  const result = runCli(
    [
      "migrate",
      "--project",
      "My App",
      "--to",
      fixture.newProject,
      "--codex-home",
      fixture.codexHome,
    ],
    fixture.root,
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Multiple Codex projects matched/);
  assert.match(result.stderr, /Use --from/);
});

test("migrate --from disambiguates duplicate project names", () => {
  const fixture = createFixture({ duplicateProject: true });
  const result = runCli(
    [
      "migrate",
      "--project",
      "My App",
      "--from",
      fixture.oldProject,
      "--to",
      fixture.newProject,
      "--codex-home",
      fixture.codexHome,
      "--execute",
    ],
    fixture.root,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.lstatSync(fixture.oldProject).isSymbolicLink(), true);
  assert.equal(fs.readlinkSync(fixture.oldProject), fixture.newProject);
  assert.equal(fs.existsSync(path.join(fixture.newProject, "app.txt")), true);

  const globalState = JSON.parse(fs.readFileSync(path.join(fixture.codexHome, ".codex-global-state.json"), "utf8"));
  assert.equal(globalState["electron-saved-workspace-roots"].includes(fixture.newProject), true);
  assert.equal(globalState["electron-saved-workspace-roots"].some((root) => root.endsWith(path.join("Other", "My App"))), true);

  const verify = runCli(
    [
      "verify",
      "--from",
      fixture.oldProject,
      "--to",
      fixture.newProject,
      "--codex-home",
      fixture.codexHome,
    ],
    fixture.root,
  );
  assert.equal(verify.status, 0, verify.stderr);
  assert.match(verify.stdout, /ok: yes/);
});

function createFixture({ duplicateProject = false, projectName = "My App" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cwm test-"));
  const codexHome = path.join(root, "codex-home");
  const sessionsDir = path.join(codexHome, "sessions");
  const sqliteDir = path.join(codexHome, "sqlite");
  const oldProject = path.join(root, "Documents", projectName);
  const newProject = path.join(root, "Workspaces", projectName);
  const oldProjectSrc = path.join(oldProject, "src");
  const sessionFile = path.join(sessionsDir, "thread-1.jsonl");
  fs.mkdirSync(oldProjectSrc, { recursive: true });
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.mkdirSync(sqliteDir, { recursive: true });
  fs.writeFileSync(path.join(oldProject, "app.txt"), "hello\n");

  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    `[projects.${tomlString(oldProject)}]\ntrust_level = "trusted"\n`,
  );
  const savedRoots = [oldProject];
  if (duplicateProject) {
    const duplicate = path.join(root, "Other", projectName);
    fs.mkdirSync(duplicate, { recursive: true });
    savedRoots.push(duplicate);
  }
  fs.writeFileSync(
    path.join(codexHome, ".codex-global-state.json"),
    `${JSON.stringify(
      {
        "electron-saved-workspace-roots": savedRoots,
        "project-order": savedRoots,
        "thread-project-assignments": {
          "thread-1": {
            projectId: oldProject,
            projectKind: "local",
            path: oldProject,
          },
        },
        "thread-workspace-root-hints": {
          "thread-1": oldProject,
        },
        "projectless-thread-ids": ["thread-1", "other"],
        "some-array": ["dup", "dup", oldProjectSrc, oldProjectSrc],
      },
      null,
      2,
    )}\n`,
  );

  fs.writeFileSync(
    sessionFile,
    [
      JSON.stringify({ type: "session_meta", payload: { cwd: oldProjectSrc } }),
      JSON.stringify({
        type: "turn_context",
        payload: {
          cwd: oldProjectSrc,
          sandbox_policy: { cwd: oldProjectSrc },
          permission_profile: { roots: [oldProjectSrc] },
          file_system_sandbox_policy: { writable_roots: [oldProjectSrc] },
        },
      }),
      JSON.stringify({ type: "response_item", payload: { message: `Keep original text ${oldProject}/src` } }),
    ].join("\n") + "\n",
  );

  const stateDb = path.join(codexHome, "state_5.sqlite");
  execFileSync("sqlite3", [
    stateDb,
    [
      "create table threads (id text, cwd text, sandbox_policy text, source text, thread_source text, has_user_event integer, preview text, first_user_message text, title text, rollout_path text);",
      `insert into threads values (${q("thread-1")}, ${q(oldProjectSrc)}, ${q(JSON.stringify({ cwd: oldProjectSrc }))}, ${q("cli")}, ${q("")}, 0, ${q("hello")}, ${q("")}, ${q("Title")}, ${q(sessionFile)});`,
    ].join("\n"),
  ]);

  const automationDb = path.join(sqliteDir, "codex-dev.db");
  execFileSync("sqlite3", [
    automationDb,
    [
      "create table automations (prompt text, cwds text);",
      "create table automation_runs (source_cwd text, archived_user_message text, archived_assistant_message text, archived_reason text);",
      `insert into automations values (${q(`Run in ${oldProjectSrc}`)}, ${q(oldProjectSrc)});`,
      `insert into automation_runs values (${q(oldProjectSrc)}, ${q(`User ${oldProjectSrc}`)}, ${q(`Assistant ${oldProjectSrc}`)}, ${q(`Reason ${oldProjectSrc}`)});`,
    ].join("\n"),
  ]);

  return {
    root,
    codexHome,
    oldProject,
    newProject,
    sessionFile,
  };
}

function runCli(args, cwd) {
  const effectiveArgs = [...args];
  if (effectiveArgs[0] === "migrate" && effectiveArgs.includes("--execute") && !effectiveArgs.includes("--force-running-codex")) {
    effectiveArgs.push("--force-running-codex");
  }

  return spawnSync(process.execPath, [CLI, ...effectiveArgs], {
    cwd,
    encoding: "utf8",
    env: { ...process.env },
  });
}

function sqliteJson(db, sql) {
  const text = execFileSync("sqlite3", ["-json", db, sql], { encoding: "utf8" }).trim();
  return text ? JSON.parse(text) : [];
}

function readJsonl(file) {
  return fs
    .readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

function q(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function localOffsetFor(date) {
  const offsetMinutes = date.getTimezoneOffset();
  const sign = offsetMinutes <= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offsetMinutes);
  const hours = Math.floor(absoluteOffset / 60);
  const minutes = absoluteOffset % 60;
  return `${sign}${String(hours).padStart(2, "0")}-${String(minutes).padStart(2, "0")}`;
}
