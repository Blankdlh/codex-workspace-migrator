import path from "node:path";
import { expandPath } from "../core/paths.mjs";

export function codexLocations(codexHomeInput = "~/.codex", cwd = process.cwd()) {
  const home = expandPath(codexHomeInput, cwd);
  return {
    home,
    config: path.join(home, "config.toml"),
    globalState: path.join(home, ".codex-global-state.json"),
    stateDb: path.join(home, "state_5.sqlite"),
    automationDb: path.join(home, "sqlite", "codex-dev.db"),
    sessionsRoot: path.join(home, "sessions"),
  };
}

