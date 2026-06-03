# Codex Workspace Migrator

Safely move a local Codex project root to a new path while preserving project grouping, historical sessions, and local Codex metadata.

## Requirements

- Node.js 20 or newer
- `sqlite3` available on `PATH`

## Usage

Run without installing:

```bash
npx --yes codex-workspace-migrator@latest doctor
npx --yes codex-workspace-migrator@latest list
```

Optional global install:

```bash
npm install -g codex-workspace-migrator
codex-workspace-migrator doctor
```

## Quick Start

Quit Codex Desktop before running commands with `--execute`.

```bash
npx --yes codex-workspace-migrator@latest doctor
npx --yes codex-workspace-migrator@latest list
```

Preview a migration:

```bash
npx --yes codex-workspace-migrator@latest migrate --project "My App" --to ~/Workspaces/MyApp
```

Apply it:

```bash
npx --yes codex-workspace-migrator@latest migrate --project "My App" --to ~/Workspaces/MyApp --execute
```

Verify the result:

```bash
npx --yes codex-workspace-migrator@latest verify --from "/old/project/root" --to ~/Workspaces/MyApp
```

Inspect rollback readiness:

```bash
npx --yes codex-workspace-migrator@latest rollback
```

Apply rollback only if the dry-run plan is correct:

```bash
npx --yes codex-workspace-migrator@latest rollback --execute
```

Use `--from <path>` instead of `--project <name>` when multiple projects share the same basename.

## Live Migration Flow

Use this flow before migrating a real project.

1. Fully quit Codex Desktop before any command that uses `--execute`.
2. Pick the project name and a target path that does not already exist:

   ```bash
   CWM="npx --yes codex-workspace-migrator@latest"
   PROJECT_NAME="My App"
   TARGET_PATH="$HOME/Workspaces/My App"
   ```

3. Run read-only checks:

   ```bash
   $CWM doctor
   $CWM list
   ```

   Confirm that `sqlite3` is available, Codex Desktop is not running, and the project root is the one you intend to move.

4. Run a dry-run:

   ```bash
   $CWM migrate --project "$PROJECT_NAME" --to "$TARGET_PATH"
   ```

   If the project name is ambiguous:

   ```bash
   $CWM migrate --from "/old/project/root" --to "$TARGET_PATH"
   ```

   Confirm that `from`, `to`, thread counts, metadata counts, and update flags look right. Do not continue if the dry-run resolves the wrong project.

5. Execute only after Codex Desktop is closed:

   ```bash
   $CWM migrate --project "$PROJECT_NAME" --to "$TARGET_PATH" --execute
   ```

6. Verify:

   ```bash
   $CWM verify --from "/old/project/root" --to "$TARGET_PATH"
   ```

   Confirm `ok: yes`, zero old-path residuals, and zero rollout/automation old-path rows.

7. Open Codex Desktop and confirm the project appears under the new path and historical conversations are visible.

8. Inspect rollback readiness:

   ```bash
   $CWM rollback
   ```

   Confirm the manifest path, backup count, and filesystem actions match the migration before running `rollback --execute`.

## Commands

- `list`: list known local Codex projects.
- `migrate`: move one project root and update Codex metadata.
- `verify`: check that old-path references are gone for a migration.
- `doctor`: check local prerequisites.
- `rollback`: restore a manifest-recorded migration.

## Manifests

Each executed migration writes:

```text
.codex-workspace-migration/<local-timestamp>/manifest.json
```

The timestamp uses the local machine timezone, for example:

```text
2026-06-03T14-29-38-859+08-00
```

The latest migration is also recorded in:

```text
.codex-workspace-migration/latest.json
```

`rollback` uses the latest manifest by default. Pass `--manifest <path>` to inspect or roll back a specific migration.

## Safety

- Commands are dry-run by default unless `--execute` is passed.
- `migrate --execute` refuses to run while Codex Desktop appears active.
- The target path must not already exist.
- The target path must not be inside the source project path.
- The old path becomes a symlink to the new path by default; use `--no-symlink` to skip it.
- Changed Codex files and SQLite databases are backed up before mutation.
- Rollback verifies backup checksums before restoring.
- Rollout JSONL updates are limited to structured metadata fields; chat text is not rewritten.

## Development

```bash
npm test
npm run check
```

`npm run check` runs the test suite, an npm pack dry-run, and a publish dry-run. CI runs the same checks on Node.js 20 and 22.

Maintainer release flow is defined in `.codex/skills/release/SKILL.md`.
