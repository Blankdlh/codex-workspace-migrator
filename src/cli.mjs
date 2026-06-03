#!/usr/bin/env node

import { parseArgs } from "./core/args.mjs";
import { runDoctor } from "./commands/doctor.mjs";
import { runList } from "./commands/list.mjs";
import { runMigrate } from "./commands/migrate.mjs";
import { runRollback } from "./commands/rollback.mjs";
import { runVerify } from "./commands/verify.mjs";
import { helpFor, isHelpRequested } from "./core/help.mjs";
import { packageVersion } from "./core/version.mjs";

const command = process.argv[2];

if (!command || command === "--help" || command === "-h") {
  console.log(helpFor());
  process.exit(0);
}

if (command === "--version" || command === "-v" || command === "version") {
  console.log(packageVersion());
  process.exit(0);
}

const options = parseArgs(process.argv.slice(3));

try {
  if (isHelpRequested(command, options)) {
    console.log(helpFor(command));
    process.exit(0);
  }

  switch (command) {
    case "list":
      runList(options);
      break;
    case "migrate":
      runMigrate(options);
      break;
    case "verify":
      runVerify(options);
      break;
    case "doctor":
      runDoctor(options);
      break;
    case "rollback":
      runRollback(options);
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  console.error(error?.message || String(error));
  if (options.verbose && error?.stack) console.error(error.stack);
  process.exit(1);
}
