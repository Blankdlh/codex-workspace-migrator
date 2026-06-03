import { codexLocations } from "../codex/locations.mjs";
import { exists } from "../core/fs.mjs";
import { listCodexProcesses } from "../core/process-check.mjs";
import { sqliteAvailable } from "../core/sqlite.mjs";

export function runDoctor(options) {
  const locations = codexLocations(options.codexHome);
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  const checks = [
    ["Node >= 20", nodeMajor >= 20, process.versions.node],
    ["sqlite3 available", sqliteAvailable(), sqliteAvailable() ? "found" : "missing"],
    ["Codex home exists", exists(locations.home), locations.home],
  ];
  const codexProcesses = listCodexProcesses();
  checks.push(["Codex Desktop not running", codexProcesses.length === 0, codexProcesses.length ? codexProcesses.join(" | ") : "not running"]);

  for (const [label, ok, detail] of checks) {
    console.log(`${ok ? "ok" : "warn"} - ${label}: ${detail}`);
  }

  if (process.platform === "darwin") {
    console.log("note - If ~/Documents or ~/.codex access fails with Operation not permitted, grant Full Disk Access to your terminal.");
  }
}

