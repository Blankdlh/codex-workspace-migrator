import { exists } from "../core/fs.mjs";
import { isInsideOrEqual, structuredTextHasKnownPath } from "../core/paths.mjs";
import {
  pathPrefixCondition,
  runSql,
  runSqlJson,
  sqlQuote,
  tableColumns,
  updateTextColumnsByPath,
} from "../core/sqlite.mjs";

export function getThreadRows(db) {
  if (!exists(db)) return [];
  const columns = tableColumns(db, "threads");
  if (!columns.includes("id") || !columns.includes("cwd")) return [];
  try {
    return runSqlJson(db, "select id, cwd from threads where cwd is not null and cwd <> '';");
  } catch {
    return [];
  }
}

export function updateStateDb(db, rewrite) {
  if (!exists(db)) return { changed: false, relatedThreads: 0 };
  const columns = tableColumns(db, "threads");
  if (columns.length === 0) return { changed: false, relatedThreads: 0 };
  const beforeRows = getThreadRows(db);
  const relatedThreads = beforeRows.filter((row) => isInsideOrEqual(row.cwd, rewrite.from) || isInsideOrEqual(row.cwd, rewrite.exactTo)).length;
  const statements = ["begin;"];

  if (columns.includes("cwd")) {
    statements.push(
      `update threads set cwd = ${sqlQuote(rewrite.exactTo)} where cwd = ${sqlQuote(rewrite.from)} or ${pathPrefixCondition("cwd", rewrite.from)} or ${pathPrefixCondition("cwd", rewrite.exactTo)};`,
    );
  }
  if (columns.includes("thread_source") && columns.includes("source")) {
    statements.push("update threads set thread_source = 'user' where (thread_source is null or thread_source = '') and source in ('vscode', 'cli');");
    statements.push("update threads set thread_source = 'subagent' where (thread_source is null or thread_source = '') and source like '%\"subagent\"%';");
  }
  if (columns.includes("first_user_message") && columns.includes("preview")) {
    statements.push("update threads set first_user_message = preview where first_user_message = '' and preview <> '' and coalesce(thread_source, '') = 'user';");
  }
  if (columns.includes("first_user_message") && columns.includes("preview") && columns.includes("title")) {
    statements.push("update threads set first_user_message = title where first_user_message = '' and preview = '' and title <> '' and coalesce(thread_source, '') = 'user';");
  }
  if (columns.includes("preview") && columns.includes("first_user_message")) {
    statements.push("update threads set preview = first_user_message where preview = '' and first_user_message <> '';");
  }
  if (columns.includes("preview") && columns.includes("title")) {
    statements.push("update threads set preview = title where preview = '' and title <> '';");
  }
  if (columns.includes("has_user_event") && columns.includes("thread_source")) {
    const contentChecks = ["1 = 0"];
    if (columns.includes("first_user_message")) contentChecks.push("first_user_message <> ''");
    if (columns.includes("preview")) contentChecks.push("preview <> ''");
    if (columns.includes("title")) contentChecks.push("title <> ''");
    statements.push(`update threads set has_user_event = 1 where has_user_event = 0 and coalesce(thread_source, '') = 'user' and (${contentChecks.join(" or ")});`);
  }

  statements.push("commit;");
  runSql(db, statements.join("\n"));
  const textColumns = columns.includes("sandbox_policy") ? updateTextColumnsByPath(db, "threads", ["sandbox_policy"], rewrite) : { changedRows: 0, changedCells: 0 };
  return { changed: statements.length > 2 || textColumns.changedRows > 0, relatedThreads, textColumns };
}

export function getRolloutPaths(db) {
  if (!exists(db)) return [];
  const columns = tableColumns(db, "threads");
  if (!columns.includes("rollout_path")) return [];
  try {
    return runSqlJson(
      db,
      "select distinct rollout_path from threads where rollout_path is not null and rollout_path <> '';",
    ).map((row) => String(row.rollout_path));
  } catch {
    return [];
  }
}

export function countStateDbOldPathRows(db, rewrite) {
  if (!exists(db)) return 0;
  const columns = tableColumns(db, "threads");
  if (!columns.includes("cwd")) return 0;
  const selectedColumns = ["cwd"];
  if (columns.includes("sandbox_policy")) selectedColumns.push("sandbox_policy");
  const rows = runSqlJson(db, `select ${selectedColumns.join(", ")} from threads;`);
  return rows.filter((row) => {
    const cwdRemaining = typeof row.cwd === "string" && isInsideOrEqual(row.cwd, rewrite.from);
    const sandboxRemaining = columns.includes("sandbox_policy") && structuredTextHasKnownPath(row.sandbox_policy, rewrite);
    return cwdRemaining || sandboxRemaining;
  }).length;
}

export function countNestedNewCwdRows(db, rewrite) {
  if (!exists(db)) return 0;
  const columns = tableColumns(db, "threads");
  if (!columns.includes("cwd")) return 0;
  const rows = runSqlJson(db, `select count(*) as count from threads where ${pathPrefixCondition("cwd", rewrite.exactTo)};`);
  return Number(rows[0]?.count || 0);
}

export function countInvisibleUserRows(db, rewrite) {
  if (!exists(db)) return 0;
  const columns = tableColumns(db, "threads");
  const required = ["cwd", "source", "thread_source", "has_user_event"];
  if (!required.every((column) => columns.includes(column))) return 0;
  const contentChecks = [];
  if (columns.includes("title")) contentChecks.push("title <> ''");
  if (columns.includes("first_user_message")) contentChecks.push("first_user_message <> ''");
  if (columns.includes("preview")) contentChecks.push("preview <> ''");
  if (contentChecks.length === 0) return 0;
  const rows = runSqlJson(
    db,
    `select count(*) as count from threads where cwd = ${sqlQuote(rewrite.exactTo)} and source in ('vscode', 'cli') and (${contentChecks.join(" or ")}) and (coalesce(thread_source, '') <> 'user' or has_user_event = 0);`,
  );
  return Number(rows[0]?.count || 0);
}
