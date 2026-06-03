import fs from "node:fs";

export function packageVersion() {
  const packageJson = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  return packageJson.version;
}
