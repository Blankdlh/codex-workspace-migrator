import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function exists(file) {
  try {
    fs.lstatSync(file);
    return true;
  } catch (error) {
    if (error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return false;
    throw error;
  }
}

export function readJson(file, fallback = null) {
  if (!exists(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function sha256(file) {
  if (!exists(file)) return null;
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

export function copyFileWithDirs(from, to) {
  ensureDir(path.dirname(to));
  fs.copyFileSync(from, to);
}

export function* walkFiles(root) {
  if (!exists(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(file);
    } else if (entry.isFile()) {
      yield file;
    }
  }
}

