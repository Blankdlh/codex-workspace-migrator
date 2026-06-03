const HELP = {
  main: `codex-workspace-migrator

Usage:
  codex-workspace-migrator <command> [options]

Commands:
  list       List known Codex projects
  migrate    Migrate one Codex project root
  verify     Verify project path migration state
  doctor     Check local prerequisites
  rollback   Roll back a manifest-recorded migration

Options:
  --help      Show this help
  --version   Print CLI version

Use codex-workspace-migrator <command> --help for command-specific options.
`,
  list: `codex-workspace-migrator list

Usage:
  codex-workspace-migrator list [options]

Options:
  --codex-home <path>   Codex home directory. Default: ~/.codex
  --json                Print JSON output
`,
  migrate: `codex-workspace-migrator migrate

Usage:
  codex-workspace-migrator migrate --project <name> --to <path> [options]
  codex-workspace-migrator migrate --from <path> --to <path> [options]

Options:
  --project <name>        Codex project name, matched by project-root basename
  --from <path>           Exact source project path, used to disambiguate
  --to <path>             New project root path. Must not already exist
  --codex-home <path>     Codex home directory. Default: ~/.codex
  --manifest <path>       Manifest output path. Default: .codex-workspace-migration/<local-timestamp>/manifest.json
  --no-symlink            Do not leave a compatibility symlink at the old path
  --force-running-codex   Allow execution while Codex Desktop appears to be running
  --execute               Apply changes. Without this, migrate is a dry-run
  --json                  Print JSON dry-run output
`,
  verify: `codex-workspace-migrator verify

Usage:
  codex-workspace-migrator verify --from <path> --to <path> [options]
  codex-workspace-migrator verify --project <name> --to <path> [options]

Options:
  --project <name>      Codex project name, matched by project-root basename
  --from <path>         Original project root path
  --to <path>           New project root path
  --codex-home <path>   Codex home directory. Default: ~/.codex
  --json                Print JSON output
`,
  doctor: `codex-workspace-migrator doctor

Usage:
  codex-workspace-migrator doctor [options]

Options:
  --codex-home <path>   Codex home directory. Default: ~/.codex
`,
  rollback: `codex-workspace-migrator rollback

Usage:
  codex-workspace-migrator rollback [options]

Options:
  --manifest <path>   Migration manifest path. Default: latest migration in .codex-workspace-migration
  --execute           Apply rollback. Without this, rollback is a dry-run
`,
};

export function helpFor(command = "main") {
  return HELP[command] || HELP.main;
}

export function isHelpRequested(command, options) {
  return command === "--help" || command === "-h" || Boolean(options.help || options.h);
}
