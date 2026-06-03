import fs from "node:fs";
import { codexLocations } from "../codex/locations.mjs";
import { resolveProject } from "../codex/project-resolver.mjs";
import { exists } from "./fs.mjs";
import { buildPathRewrite, expandPath, isInsideOrEqual, normalizePath, projectNameFromPath } from "./paths.mjs";

export function buildSingleProjectPlan(options, cwd = process.cwd()) {
  const codexHome = options.codexHome || "~/.codex";
  const to = normalizePath(expandPath(options.to, cwd));
  let from;
  let name = options.project;
  let resolver = null;

  if (options.from) {
    from = normalizePath(expandPath(options.from, cwd));
    name = name || projectNameFromPath(from);
    resolver = resolveProject({ project: name, from, codexHome, cwd });
  } else {
    resolver = resolveProject({ project: name, codexHome, cwd });
    from = resolver.selected.path;
    name = resolver.selected.name;
  }

  const rewrite = buildPathRewrite(from, to);
  const locations = codexLocations(codexHome, cwd);
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    mode: "single-project",
    project: {
      name,
      from,
      to,
      sources: resolver?.selected?.sources || [],
      warning: resolver?.selected?.warning || null,
    },
    filesystem: {
      move: true,
      leaveSymlink: options.symlink !== false,
      requireMissingTarget: true,
    },
    pathRewrite: rewrite,
    codex: {
      home: locations.home,
      fixConfig: true,
      fixGlobalState: true,
      fixStateDb: true,
      fixAutomationDb: true,
      fixSessionsJsonl: true,
      canonicalizeThreadCwdToProjectRoot: true,
    },
  };
}

export function validatePlanForMove(plan) {
  const from = plan.project.from;
  const to = plan.project.to;
  if (!exists(from)) throw new Error(`Source project path does not exist: ${from}`);
  const stat = fs.lstatSync(from);
  if (!stat.isDirectory()) throw new Error(`Source project path is not a directory: ${from}`);
  if (stat.isSymbolicLink()) throw new Error(`Source project path is a symlink; refusing to migrate it: ${from}`);
  if (exists(to)) throw new Error(`Target project path already exists: ${to}`);
  if (to !== from && isInsideOrEqual(to, from)) {
    throw new Error(`Target project path cannot be inside the source project path: ${to}`);
  }
}
