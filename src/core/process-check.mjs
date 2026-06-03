import { execFileSync } from "node:child_process";

export function listCodexProcesses() {
  try {
    const ps = execFileSync("ps", ["-axo", "pid=,comm=,args="], { encoding: "utf8" });
    return ps
      .split("\n")
      .map((line) => line.trim())
      .filter(isCodexBlockingProcess)
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function isCodexBlockingProcess(line) {
  if (!line.includes("/Codex.app/Contents/")) return false;
  if (line.includes("/Helpers/browser_crashpad_handler")) return false;
  return true;
}

export function assertCodexIsClosed({ force = false } = {}) {
  const processes = listCodexProcesses();
  if (processes.length === 0 || force) return processes;
  throw new Error(`Codex Desktop is still running. Quit Codex completely before executing migration.\n${processes.join("\n")}`);
}
