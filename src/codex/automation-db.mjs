import { exists } from "../core/fs.mjs";
import { structuredTextHasKnownPath } from "../core/paths.mjs";
import { quoteIdentifier, runSqlJson, tableColumns, tableExists, updateTextColumnsByPath } from "../core/sqlite.mjs";

const AUTOMATION_COLUMNS = {
  automations: ["prompt", "cwds"],
  automation_runs: ["source_cwd", "archived_user_message", "archived_assistant_message", "archived_reason"],
};

export function updateAutomationDb(db, rewrite) {
  if (!exists(db)) return { changed: false };
  let changedRows = 0;
  let changedCells = 0;

  if (tableExists(db, "automations")) {
    const columns = tableColumns(db, "automations").filter((column) => AUTOMATION_COLUMNS.automations.includes(column));
    const result = updateTextColumnsByPath(db, "automations", columns, rewrite);
    changedRows += result.changedRows;
    changedCells += result.changedCells;
  }

  if (tableExists(db, "automation_runs")) {
    const columns = tableColumns(db, "automation_runs").filter((column) =>
      AUTOMATION_COLUMNS.automation_runs.includes(column),
    );
    const result = updateTextColumnsByPath(db, "automation_runs", columns, rewrite);
    changedRows += result.changedRows;
    changedCells += result.changedCells;
  }

  return { changed: changedRows > 0, changedRows, changedCells };
}

export function countAutomationOldPathRows(db, rewrite) {
  if (!exists(db)) return 0;
  let count = 0;
  for (const [table, expectedColumns] of Object.entries(AUTOMATION_COLUMNS)) {
    if (!tableExists(db, table)) continue;
    const columns = tableColumns(db, table).filter((column) => expectedColumns.includes(column));
    if (columns.length === 0) continue;
    const selectedColumns = columns.map((column) => quoteIdentifier(column)).join(", ");
    const rows = runSqlJson(db, `select ${selectedColumns} from ${quoteIdentifier(table)};`);
    count += rows.filter((row) => columns.some((column) => structuredTextHasKnownPath(row[column], rewrite))).length;
  }
  return count;
}
