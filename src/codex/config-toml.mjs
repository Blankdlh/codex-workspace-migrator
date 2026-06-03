import fs from "node:fs";
import { exists } from "../core/fs.mjs";
import { replaceKnownPath } from "../core/paths.mjs";

export function parseProjectSections(text) {
  return [...text.matchAll(projectSectionPattern())]
    .map((match) => decodeTomlBasicString(match[1]))
    .filter((value) => value != null);
}

export function updateConfigToml(file, rewrite) {
  if (!exists(file)) return { changed: false, projectSections: 0 };
  const original = fs.readFileSync(file, "utf8");
  let text = replaceProjectSectionPaths(original, rewrite);
  text = replaceKnownPath(text, rewrite);
  const existingProjects = new Set(parseProjectSections(text));
  if (!existingProjects.has(rewrite.exactTo)) {
    text += `${text.endsWith("\n") ? "" : "\n"}\n[projects.${encodeTomlBasicString(rewrite.exactTo)}]\ntrust_level = "trusted"\n`;
  }
  text = dedupeTomlProjectSections(text);
  if (text === original) return { changed: false, projectSections: parseProjectSections(text).length };
  fs.writeFileSync(file, text);
  return { changed: true, projectSections: parseProjectSections(text).length };
}

export function replaceProjectSectionPaths(text, rewrite) {
  return text.replace(projectSectionPattern(), (line, encodedPath) => {
    const decodedPath = decodeTomlBasicString(encodedPath);
    if (decodedPath == null) return line;
    const nextPath = replaceKnownPath(decodedPath, rewrite);
    if (nextPath === decodedPath) return line;
    return `[projects.${encodeTomlBasicString(nextPath)}]`;
  });
}

export function dedupeTomlProjectSections(text) {
  const lines = text.split("\n");
  const output = [];
  let block = [];
  let projectPath = null;
  const seenProjectPaths = new Set();

  function flush() {
    if (block.length === 0) return;
    if (projectPath) {
      if (!seenProjectPaths.has(projectPath)) {
        seenProjectPaths.add(projectPath);
        output.push(...block);
      }
    } else {
      output.push(...block);
    }
    block = [];
    projectPath = null;
  }

  for (const line of lines) {
    const projectMatch = line.match(projectSectionLinePattern());
    const sectionMatch = line.match(/^\[[^\]]+\]\s*$/);
    if (sectionMatch) {
      flush();
      projectPath = projectMatch ? decodeTomlBasicString(projectMatch[1]) : null;
    }
    block.push(line);
  }
  flush();

  return output.join("\n").replace(/\n{3,}/g, "\n\n");
}

function projectSectionPattern() {
  return /^\[projects\.("(?:(?:\\.|[^"\\])*)")\]\s*$/gm;
}

function projectSectionLinePattern() {
  return /^\[projects\.("(?:(?:\\.|[^"\\])*)")\]\s*$/;
}

export function encodeTomlBasicString(value) {
  return JSON.stringify(String(value));
}

export function decodeTomlBasicString(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
