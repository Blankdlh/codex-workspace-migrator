import { collectProjects } from "../codex/project-resolver.mjs";
import { printJson, printProjectTable } from "../core/output.mjs";

export function runList(options) {
  const projects = collectProjects({ codexHome: options.codexHome });
  if (options.json) {
    printJson(projects);
  } else {
    printProjectTable(projects);
  }
}

