# Release

Use this skill when preparing, checking, or publishing this package to npm.

## Versioning

Default to the normal release path:

```bash
npm version patch -m "Release v%s"
```

Use `minor`, `major`, or an explicit version when the user asks for it. For prereleases, use:

```bash
npm version prerelease --preid beta -m "Release v%s"
```

The first ever publish can be handled manually with an explicit Git tag if the package version is already correct. Do not make that one-off path the default skill flow.

## Workflow

1. Confirm the intended version bump with the user unless they already specified it.

2. Confirm repository state with `git status --short --ignored`.

   Expected:

   - source, package metadata, tests, README, and skill files are tracked or intentionally staged;
   - `legacy/`, `.npm-cache/`, and `.codex-workspace-migration/` remain ignored;
   - no generated tarball is present in the repository root.

3. Run `npm run prepublishOnly`.

   This runs:

   - `npm test`
   - `npm run pack:dry-run`
   - `npm run publish:dry-run`

4. Inspect the npm dry-run package contents in the command output. The package should include only source files, `README.md`, `LICENSE`, and `package.json`.

5. Confirm the README live migration flow has passed on a real Codex project before publishing.

   Keep these results in release notes or a local release record:

   - dry-run output resolves the intended project and target path;
   - execute output includes a manifest path;
   - `verify --from <old> --to <target>` reports `ok: yes`;
   - Codex Desktop shows historical conversations under the new path;
   - rollback dry-run can read the default/latest manifest and backup directory.

6. Recheck the current published npm version:

   ```bash
   npm view codex-workspace-migrator version
   ```

   For the first publish, `E404 Not Found` means the name is still available. For later publishes, the returned version must be lower than the version to publish.

7. Stop before changing version, tagging, or publishing unless the user explicitly asks to proceed.

8. Run the selected `npm version ... -m "Release v%s"` command.

9. Run `npm run prepublishOnly` again after the version commit/tag.

10. Publish:

   ```bash
   npm publish --access public
   ```

   For prereleases, use the requested dist-tag, for example:

   ```bash
   npm publish --tag beta --access public
   ```

11. Push the release commit and tag:

   ```bash
   git push origin main
   git push origin --tags
   ```

12. After publish, run:

   ```bash
   npm view codex-workspace-migrator version
   npm install -g codex-workspace-migrator
   codex-workspace-migrator --version
   codex-workspace-migrator --help
   ```

## Guardrails

- Do not publish from a dirty worktree unless the user explicitly approves the exact dirty state.
- Do not publish if `npm run prepublishOnly` fails.
- Do not publish if npm dry-run reports package auto-corrections or unexpected package contents.
- Do not publish if the target version is already present on npm.
- Do not perform a real live migration as part of release unless the user provides the source and target project paths and explicitly asks for it.
- Do not run `npm version`, `npm publish`, or `git push` without explicit user approval in the current turn.
