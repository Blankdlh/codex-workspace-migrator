# Codex Workspace Migrator Technical Design

## Purpose

`codex-workspace-migrator` moves one local Codex project root to a new path while preserving Codex project grouping, historical sessions, and rollback capability.

The tool updates the local Codex state that can reference project roots:

- `~/.codex/config.toml`
- `~/.codex/.codex-global-state.json`
- `~/.codex/state_5.sqlite`
- `~/.codex/sqlite/codex-dev.db`
- `~/.codex/sessions/**/*.jsonl`

## Command Surface

### `list`

Lists local Codex projects discovered from config, global state, and SQLite thread rows.

```bash
codex-workspace-migrator list
codex-workspace-migrator list --json
```

Each project includes:

- project name, derived from the project root basename;
- project root path;
- source records that referenced the path;
- thread count;
- whether the path exists;
- whether the path is a symlink.

### `migrate`

Previews or applies one project-root migration.

```bash
codex-workspace-migrator migrate --project "My App" --to ~/Workspaces/MyApp
codex-workspace-migrator migrate --project "My App" --to ~/Workspaces/MyApp --execute
codex-workspace-migrator migrate --from ~/Old/MyApp --to ~/Workspaces/MyApp --execute
```

Options:

```text
--project <name>        Project name, matched by project root basename
--from <path>           Exact source project path
--to <path>             New project root path; must not already exist
--codex-home <path>     Codex home directory; default: ~/.codex
--manifest <path>       Manifest output path
--no-symlink            Do not leave a symlink at the old path
--force-running-codex   Allow execution while Codex Desktop appears active
--execute               Apply changes; otherwise dry-run only
--json                  Print JSON dry-run output
```

### `verify`

Checks migration state for an old path and new path.

```bash
codex-workspace-migrator verify --from ~/Old/MyApp --to ~/Workspaces/MyApp
codex-workspace-migrator verify --project "My App" --to ~/Workspaces/MyApp
```

Verification checks:

- target path exists;
- old path is absent or is a symlink to the target;
- no old path remains in `config.toml`;
- no old path remains in global state;
- no old path remains in `state_5.sqlite` cwd or sandbox policy fields;
- migrated `threads.cwd` values are canonicalized to the new project root;
- migrated user threads have visibility metadata;
- no old path remains in structured rollout JSONL metadata;
- no old path remains in supported automation DB columns.

### `doctor`

Checks local prerequisites.

```bash
codex-workspace-migrator doctor
```

Checks:

- Node.js version;
- `sqlite3` availability;
- Codex home existence;
- whether Codex Desktop appears active;
- macOS Full Disk Access hint.

### `rollback`

Previews or restores a manifest-recorded migration.

```bash
codex-workspace-migrator rollback
codex-workspace-migrator rollback --execute
codex-workspace-migrator rollback --manifest .codex-workspace-migration/2026-06-03T14-29-38-859+08-00/manifest.json
```

`rollback` uses the latest manifest by default. `--manifest <path>` selects a specific manifest.

Rollback restores only actions recorded by the manifest:

- backed-up text files;
- backed-up SQLite databases;
- backed-up JSONL files;
- old-path symlink removal;
- project directory move back to the original path.

Rollback performs preflight checks before changing anything. It refuses to proceed if a backup is missing, a backup checksum does not match, the old path has been replaced by an unexpected file or directory, or the moved target directory is missing.

## Project Resolution

Project names are matched against project-root basenames. For example:

```text
/Users/alice/Projects/My App -> My App
```

Candidate project roots are collected from:

1. `.codex-global-state.json` `electron-saved-workspace-roots`
2. `.codex-global-state.json` `project-order`
3. `.codex-global-state.json` `thread-project-assignments`
4. `config.toml` project sections
5. `state_5.sqlite` `threads.cwd`

Matching order:

1. exact basename match;
2. exact match after trimming whitespace;
3. case-insensitive basename match.

If no project matches, the CLI prints known projects and refuses to migrate. If multiple projects match, the CLI refuses to guess and requires `--from <path>`.

When `--from` is provided, it is the authoritative source path. `--project` is optional display metadata.

## Migration Plan

Each migration creates a single-project plan containing:

```json
{
  "version": 1,
  "mode": "single-project",
  "project": {
    "name": "My App",
    "from": "/Users/alice/Old/My App",
    "to": "/Users/alice/Workspaces/My App"
  },
  "filesystem": {
    "move": true,
    "leaveSymlink": true,
    "requireMissingTarget": true
  },
  "pathRewrite": {
    "from": "/Users/alice/Old/My App",
    "exactTo": "/Users/alice/Workspaces/My App",
    "prefixTo": "/Users/alice/Workspaces/My App",
    "exactOnly": false
  },
  "codex": {
    "home": "/Users/alice/.codex",
    "fixConfig": true,
    "fixGlobalState": true,
    "fixStateDb": true,
    "fixAutomationDb": true,
    "fixSessionsJsonl": true,
    "canonicalizeThreadCwdToProjectRoot": true
  }
}
```

The target path must not exist and must not be inside the source project path. The source path must exist, be a directory, and not be a symlink.

## Data Updates

### Config TOML

File:

```text
~/.codex/config.toml
```

Updates:

- replace project section paths;
- add trust entry for the new path;
- dedupe repeated project sections.

### Global State

File:

```text
~/.codex/.codex-global-state.json
```

Updates:

- replace known structured path values and object keys;
- add the target path to saved workspace roots;
- add the target path to project order;
- reassign related threads to the new project root;
- update workspace root hints;
- remove reassigned threads from the projectless thread list.

### State SQLite

File:

```text
~/.codex/state_5.sqlite
```

Updates:

- set related `threads.cwd` values to the new project root;
- update structured path values in `threads.sandbox_policy`;
- repair user-thread visibility metadata using `source`, `thread_source`, `has_user_event`, `preview`, `first_user_message`, and `title` when those columns exist.

### Sessions JSONL

Files:

```text
~/.codex/sessions/**/*.jsonl
```

Only structured metadata fields are updated:

- `session_meta.payload.cwd`
- `turn_context.payload.cwd`
- `turn_context.payload.sandbox_policy`
- `turn_context.payload.permission_profile`
- `turn_context.payload.file_system_sandbox_policy`

The tool does not rewrite user messages, assistant messages, tool call arguments, tool output text, or unknown record bodies.

### Automation DB

File:

```text
~/.codex/sqlite/codex-dev.db
```

Supported columns:

- `automations.prompt`
- `automations.cwds`
- `automation_runs.source_cwd`
- `automation_runs.archived_user_message`
- `automation_runs.archived_assistant_message`
- `automation_runs.archived_reason`

Missing tables or columns are ignored.

## Path Replacement

Path replacement is boundary-aware rather than a global text replacement.

Rules:

- exact source path maps to exact target path;
- source-path prefixes map to target-path prefixes;
- replacements occur only on path boundaries;
- JSON strings are parsed and rewritten structurally when possible;
- already-canonical target paths are not rewritten again;
- SQL path checks do not use wildcard-sensitive `LIKE` matching.

The path rewrite model is:

```ts
type PathRewrite = {
  from: string;
  exactTo: string;
  prefixTo: string;
  exactOnly?: boolean;
};
```

## Filesystem Behavior

Execution order:

1. validate source and target paths;
2. create the manifest and backup directory;
3. move source directory to target path;
4. record the move in the manifest;
5. create old-path symlink unless `--no-symlink` is set;
6. record the symlink in the manifest;
7. update Codex state files and databases;
8. run verification;
9. finalize the manifest.

The old path becomes a symlink to the new path by default. `--no-symlink` skips this compatibility link.

## Manifest

Executed migrations write a manifest before any mutating action:

```text
.codex-workspace-migration/<local-timestamp>/manifest.json
```

`<local-timestamp>` uses the local machine timezone, for example:

```text
2026-06-03T14-29-38-859+08-00
```

The latest migration pointer is stored in:

```text
.codex-workspace-migration/latest.json
```

`migrate --manifest <path>` writes the manifest to a caller-provided path. Backups are stored in a `backups/` directory next to that manifest.

Manifest records include:

- command name;
- creation and update timestamps;
- migration plan;
- backup directory;
- backed-up file paths and SHA-256 checksums;
- filesystem actions;
- dry-run stats;
- verification result;
- failure message and stack if execution fails.

## Safety

- Commands are dry-run by default.
- Mutating commands require `--execute`.
- `migrate --execute` refuses to run while Codex Desktop appears active unless `--force-running-codex` is passed.
- All changed Codex files and databases are backed up before mutation.
- SQLite databases are backed up with `sqlite3 .backup`.
- Rollback validates backup existence and checksums before restoring.
- Rollback validates filesystem state before restoring metadata.
- Unexpected Codex schemas are handled conservatively: missing files, tables, or columns are skipped.
- macOS permission failures are surfaced with a Full Disk Access hint.

## Testing

The test suite uses fixture Codex homes and workspaces. It does not read or write the user's real `~/.codex`.

Coverage includes:

- project resolution by name;
- ambiguous project handling;
- `--from` disambiguation;
- dry-run no-write behavior;
- target path validation;
- config TOML updates;
- global state updates;
- SQLite cwd, sandbox policy, and visibility repair;
- SQL wildcard-safe paths;
- JSONL structured metadata updates without chat text rewrite;
- automation DB updates and verification;
- manifest-first execution;
- latest manifest rollback;
- custom manifest paths;
- rollback success and no-symlink rollback;
- rollback with missing filesystem action records;
- rollback checksum preflight refusal;
- rollback unsafe filesystem preflight refusal;
- package smoke test for the installed CLI binary.

## Package Shape

The package is an ESM Node.js CLI.

Requirements:

- Node.js 20 or newer;
- system `sqlite3` CLI.

Public binary:

```json
{
  "bin": {
    "codex-workspace-migrator": "src/cli.mjs"
  }
}
```

No short binary alias is exposed.
