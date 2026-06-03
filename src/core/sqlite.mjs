import { execFileSync } from "node:child_process";
import { exists } from "./fs.mjs";
import { replaceKnownPathInStructuredText } from "./paths.mjs";

export function sqliteAvailable() {
  try {
    execFileSync("sqlite3", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function sqlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function runSql(db, sql) {
  if (!exists(db)) return "";
  return execFileSync("sqlite3", [db, sql], { encoding: "utf8" });
}

export function runSqlJson(db, sql) {
  if (!exists(db)) return [];
  const text = execFileSync("sqlite3", ["-json", db, sql], { encoding: "utf8" }).trim();
  return text ? JSON.parse(text) : [];
}

export function tableColumns(db, table) {
  if (!exists(db)) return [];
  try {
    return runSqlJson(db, `pragma table_info(${quoteIdentifier(table)});`).map((row) => String(row.name));
  } catch {
    return [];
  }
}

export function tableExists(db, table) {
  if (!exists(db)) return false;
  const rows = runSqlJson(
    db,
    `select name from sqlite_master where type = 'table' and name = ${sqlQuote(table)} limit 1;`,
  );
  return rows.length > 0;
}

export function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

export function pathPrefixCondition(columnSql, root) {
  return `substr(${columnSql}, 1, ${root.length + 1}) = ${sqlQuote(`${root}/`)}`;
}

export function updateTextColumnsByPath(db, table, columns, rewrite) {
  if (!exists(db) || columns.length === 0) return { changedRows: 0, changedCells: 0 };
  const qTable = quoteIdentifier(table);
  const qColumns = columns.map((column) => quoteIdentifier(column));
  let rows;
  try {
    rows = runSqlJson(db, `select rowid as __rowid, ${qColumns.join(", ")} from ${qTable};`);
  } catch {
    return { changedRows: 0, changedCells: 0 };
  }

  let changedRows = 0;
  let changedCells = 0;
  const statements = ["begin;"];
  for (const row of rows) {
    const sets = [];
    for (const column of columns) {
      if (typeof row[column] !== "string") continue;
      const next = replacePathInSqlText(row[column], rewrite);
      if (next === row[column]) continue;
      sets.push(`${quoteIdentifier(column)} = ${sqlQuote(next)}`);
      changedCells += 1;
    }
    if (sets.length === 0) continue;
    changedRows += 1;
    statements.push(`update ${qTable} set ${sets.join(", ")} where rowid = ${Number(row.__rowid)};`);
  }
  statements.push("commit;");

  if (changedRows > 0) runSql(db, statements.join("\n"));
  return { changedRows, changedCells };
}

function replacePathInSqlText(text, rewrite) {
  return replaceKnownPathInStructuredText(text, rewrite);
}
