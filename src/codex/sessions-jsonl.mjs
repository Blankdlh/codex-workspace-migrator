import fs from "node:fs";
import { exists, walkFiles } from "../core/fs.mjs";
import { deepReplaceKnownPath, isPlainObject, replaceKnownPath } from "../core/paths.mjs";
import { getRolloutPaths } from "./state-db.mjs";

export function getSessionFiles(locations) {
  const files = new Set(getRolloutPaths(locations.stateDb).filter((file) => exists(file)));
  for (const file of walkFiles(locations.sessionsRoot)) {
    if (file.endsWith(".jsonl")) files.add(file);
  }
  return [...files].sort();
}

export function countRolloutMetadataChanges(locations, rewrite) {
  let files = 0;
  let lines = 0;
  for (const file of getSessionFiles(locations)) {
    const count = countChangedLines(file, rewrite);
    if (count > 0) {
      files += 1;
      lines += count;
    }
  }
  return { files, lines };
}

export function updateRolloutMetadata(locations, rewrite, onBeforeWrite = () => {}) {
  let changedFiles = 0;
  let changedLines = 0;
  for (const file of getSessionFiles(locations)) {
    const result = rewriteJsonlFile(file, rewrite);
    if (!result.changed) continue;
    onBeforeWrite(file);
    fs.writeFileSync(file, result.text);
    changedFiles += 1;
    changedLines += result.changedLines;
  }
  return { changedFiles, changedLines };
}

function countChangedLines(file, rewrite) {
  return rewriteJsonlFile(file, rewrite).changedLines;
}

function rewriteJsonlFile(file, rewrite) {
  const text = fs.readFileSync(file, "utf8");
  const hadTrailingNewline = text.endsWith("\n");
  const lines = text.split("\n");
  if (hadTrailingNewline) lines.pop();
  let changed = false;
  let changedLines = 0;

  const nextLines = lines.map((line) => {
    if (!line.trim()) return line;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      return line;
    }
    if (!replaceRolloutMetadataPaths(record, rewrite)) return line;
    changed = true;
    changedLines += 1;
    return JSON.stringify(record);
  });

  return {
    changed,
    changedLines,
    text: `${nextLines.join("\n")}${hadTrailingNewline ? "\n" : ""}`,
  };
}

function replaceRolloutMetadataPaths(record, rewrite) {
  if (!isPlainObject(record) || !isPlainObject(record.payload)) return false;
  let changed = false;

  if (record.type === "session_meta") {
    changed = replaceObjectPropertyPath(record.payload, "cwd", rewrite) || changed;
  } else if (record.type === "turn_context") {
    changed = replaceObjectPropertyPath(record.payload, "cwd", rewrite) || changed;
    changed = replaceObjectPath(record.payload, "sandbox_policy", rewrite) || changed;
    changed = replaceObjectPath(record.payload, "permission_profile", rewrite) || changed;
    changed = replaceObjectPath(record.payload, "file_system_sandbox_policy", rewrite) || changed;
  }

  return changed;
}

function replaceObjectPropertyPath(object, key, rewrite) {
  if (!isPlainObject(object) || typeof object[key] !== "string") return false;
  const next = replaceKnownPath(object[key], rewrite);
  if (next === object[key]) return false;
  object[key] = next;
  return true;
}

function replaceObjectPath(object, key, rewrite) {
  if (!isPlainObject(object) || object[key] == null) return false;
  const next = deepReplaceKnownPath(object[key], rewrite);
  if (JSON.stringify(next) === JSON.stringify(object[key])) return false;
  object[key] = next;
  return true;
}
