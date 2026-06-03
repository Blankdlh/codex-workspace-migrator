import { exists, readJson, writeJson } from "../core/fs.mjs";
import { deepReplaceKnownPath, isInsideOrEqual, normalizePath } from "../core/paths.mjs";
import { getThreadRows } from "./state-db.mjs";

export function updateGlobalState(file, stateDb, rewrite) {
  if (!exists(file)) return { changed: false, assignedThreads: 0 };
  const original = readJson(file, {});
  const replaced = deepReplaceKnownPath(original, rewrite);

  const savedRoots = normalizeRootList([...(replaced["electron-saved-workspace-roots"] || []), rewrite.exactTo]);
  const projectOrder = normalizeRootList([...(replaced["project-order"] || []), ...savedRoots]);
  replaced["electron-saved-workspace-roots"] = savedRoots;
  replaced["project-order"] = projectOrder;
  replaced["active-workspace-roots"] = normalizeRootList(replaced["active-workspace-roots"] || []);

  const threadRows = getThreadRows(stateDb);
  const related = threadRows.filter((row) => isInsideOrEqual(row.cwd, rewrite.from) || isInsideOrEqual(row.cwd, rewrite.exactTo));
  const assignments = isPlainObject(replaced["thread-project-assignments"]) ? replaced["thread-project-assignments"] : {};
  const hints = isPlainObject(replaced["thread-workspace-root-hints"]) ? replaced["thread-workspace-root-hints"] : {};

  for (const row of related) {
    if (!row.id) continue;
    assignments[row.id] = {
      projectId: rewrite.exactTo,
      projectKind: "local",
      path: rewrite.exactTo,
    };
    hints[row.id] = rewrite.exactTo;
  }

  replaced["thread-project-assignments"] = assignments;
  replaced["thread-workspace-root-hints"] = hints;

  if (Array.isArray(replaced["projectless-thread-ids"])) {
    const assignedIds = new Set(related.map((row) => row.id).filter(Boolean));
    replaced["projectless-thread-ids"] = replaced["projectless-thread-ids"].filter((id) => !assignedIds.has(String(id)));
  }

  if (JSON.stringify(original) === JSON.stringify(replaced)) return { changed: false, assignedThreads: related.length };
  writeJson(file, replaced);
  return { changed: true, assignedThreads: related.length };
}

function normalizeRootList(values) {
  return [...new Set((values || []).map((value) => normalizePath(String(value))).filter(Boolean))];
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

