import fs from "node:fs";
import path from "node:path";
import { exists, readJson } from "../core/fs.mjs";
import { isInsideOrEqual, normalizePath, projectNameFromPath } from "../core/paths.mjs";
import { runSqlJson, sqliteAvailable } from "../core/sqlite.mjs";
import { parseProjectSections } from "./config-toml.mjs";
import { codexLocations } from "./locations.mjs";

export function collectProjects({ codexHome = "~/.codex", cwd = process.cwd() } = {}) {
  const locations = codexLocations(codexHome, cwd);
  const projects = new Map();

  function add(projectPath, source, threadCount = 0) {
    if (!projectPath || typeof projectPath !== "string") return;
    const normalized = normalizePath(projectPath);
    const current = projects.get(normalized) || {
      name: projectNameFromPath(normalized),
      path: normalized,
      sources: new Set(),
      threadCount: 0,
      exists: exists(normalized),
      isSymlink: false,
    };
    current.sources.add(source);
    current.threadCount += threadCount;
    if (current.exists) {
      current.isSymlink = fs.lstatSync(normalized).isSymbolicLink();
    }
    projects.set(normalized, current);
  }

  const globalState = readJson(locations.globalState, {});
  for (const root of globalState?.["electron-saved-workspace-roots"] || []) add(root, "global-state:saved-root");
  for (const root of globalState?.["project-order"] || []) add(root, "global-state:project-order");
  const assignments = globalState?.["thread-project-assignments"] || {};
  for (const assignment of Object.values(assignments)) {
    if (assignment && typeof assignment === "object") add(assignment.path || assignment.projectId, "global-state:thread-assignment");
  }

  if (exists(locations.config)) {
    for (const projectPath of parseProjectSections(fs.readFileSync(locations.config, "utf8"))) {
      add(projectPath, "config");
    }
  }

  if (sqliteAvailable() && exists(locations.stateDb)) {
    try {
      const rows = runSqlJson(
        locations.stateDb,
        "select cwd, count(*) as threadCount from threads where cwd is not null and cwd <> '' group by cwd;",
      );
      for (const row of rows) add(String(row.cwd), "state-db:threads", Number(row.threadCount || 0));
    } catch {
      // Ignore incompatible SQLite schemas; doctor/verify report stronger detail.
    }
  }

  return [...projects.values()]
    .map((project) => ({
      ...project,
      sources: [...project.sources].sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
}

export function resolveProject({ project, from, codexHome = "~/.codex", cwd = process.cwd() }) {
  const projects = collectProjects({ codexHome, cwd });
  if (from) {
    const normalizedFrom = normalizePath(from);
    const exact = projects.find((candidate) => candidate.path === normalizedFrom);
    return {
      selected: exact || {
        name: project || projectNameFromPath(normalizedFrom),
        path: normalizedFrom,
        sources: [],
        threadCount: 0,
        exists: exists(normalizedFrom),
        isSymlink: exists(normalizedFrom) ? fs.lstatSync(normalizedFrom).isSymbolicLink() : false,
        warning: "Source path was not found in Codex local state.",
      },
      candidates: projects.filter((candidate) => isInsideOrEqual(candidate.path, normalizedFrom)),
      allProjects: projects,
    };
  }

  if (!project) {
    throw new Error("Missing --project or --from.");
  }

  const trimmed = project.trim();
  const exact = projects.filter((candidate) => candidate.name === project);
  const trimMatched = exact.length > 0 ? exact : projects.filter((candidate) => candidate.name.trim() === trimmed);
  const matches = trimMatched.length > 0 ? trimMatched : projects.filter((candidate) => candidate.name.toLowerCase() === trimmed.toLowerCase());

  if (matches.length === 0) {
    const names = projects.map((candidate) => `  ${candidate.name} -> ${candidate.path}`).join("\n");
    throw new Error(`No Codex project matched "${project}". Known projects:\n${names || "  (none)"}`);
  }
  if (matches.length > 1) {
    const names = matches.map((candidate) => `  ${candidate.name} -> ${candidate.path}`).join("\n");
    throw new Error(`Multiple Codex projects matched "${project}". Use --from to disambiguate:\n${names}`);
  }

  return { selected: matches[0], candidates: matches, allProjects: projects };
}

