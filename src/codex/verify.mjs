import fs from "node:fs";
import path from "node:path";
import { exists } from "../core/fs.mjs";
import { normalizePath, pathExistsInText } from "../core/paths.mjs";
import { countAutomationOldPathRows } from "./automation-db.mjs";
import { countRolloutMetadataChanges } from "./sessions-jsonl.mjs";
import { countInvisibleUserRows, countNestedNewCwdRows, countStateDbOldPathRows } from "./state-db.mjs";

export function verifyMigration({ locations, rewrite }) {
  const oldPathState = getOldPathState(rewrite);
  const filesystem = {
    targetExists: exists(rewrite.exactTo),
    ...oldPathState,
  };

  const configOldPathRemaining = exists(locations.config)
    ? countTextOldPath(locations.config, rewrite)
    : 0;
  const globalStateOldPathRemaining = exists(locations.globalState)
    ? countTextOldPath(locations.globalState, rewrite)
    : 0;
  const stateDbOldPathRows = countStateDbOldPathRows(locations.stateDb, rewrite);
  const stateDbNestedNewCwdRows = countNestedNewCwdRows(locations.stateDb, rewrite);
  const stateDbInvisibleUserRows = countInvisibleUserRows(locations.stateDb, rewrite);
  const rollout = countRolloutMetadataChanges(locations, rewrite);
  const automationOldPathRows = countAutomationOldPathRows(locations.automationDb, rewrite);

  return {
    filesystem,
    configOldPathRemaining,
    globalStateOldPathRemaining,
    stateDbOldPathRows,
    stateDbNestedNewCwdRows,
    stateDbInvisibleUserRows,
    rolloutMetadataOldPathLines: rollout.lines,
    rolloutMetadataOldPathFiles: rollout.files,
    automationOldPathRows,
    ok:
      filesystem.targetExists &&
      filesystem.oldPathAcceptable &&
      configOldPathRemaining === 0 &&
      globalStateOldPathRemaining === 0 &&
      stateDbOldPathRows === 0 &&
      stateDbNestedNewCwdRows === 0 &&
      stateDbInvisibleUserRows === 0 &&
      rollout.lines === 0 &&
      automationOldPathRows === 0,
  };
}

function getOldPathState(rewrite) {
  if (!exists(rewrite.from)) {
    return {
      oldPathExists: false,
      oldPathIsSymlink: false,
      oldPathSymlinkTarget: null,
      oldPathAcceptable: true,
    };
  }

  const stat = fs.lstatSync(rewrite.from);
  if (!stat.isSymbolicLink()) {
    return {
      oldPathExists: true,
      oldPathIsSymlink: false,
      oldPathSymlinkTarget: null,
      oldPathAcceptable: false,
    };
  }

  const target = fs.readlinkSync(rewrite.from);
  const resolvedTarget = normalizePath(path.resolve(path.dirname(rewrite.from), target));
  return {
    oldPathExists: true,
    oldPathIsSymlink: true,
    oldPathSymlinkTarget: target,
    oldPathAcceptable: resolvedTarget === normalizePath(rewrite.exactTo),
  };
}

function countTextOldPath(file, rewrite) {
  const text = fs.readFileSync(file, "utf8");
  return pathExistsInText(text, rewrite) ? 1 : 0;
}
