export function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

export function printProjectTable(projects) {
  if (projects.length === 0) {
    console.log("No Codex projects found.");
    return;
  }
  for (const project of projects) {
    console.log(`${project.name}`);
    console.log(`  path: ${project.path}`);
    console.log(`  sources: ${project.sources.join(", ") || "(none)"}`);
    console.log(`  threads: ${project.threadCount}`);
    console.log(`  exists: ${project.exists ? "yes" : "no"}`);
    console.log(`  symlink: ${project.isSymlink ? "yes" : "no"}`);
  }
}

export function printVerification(result) {
  console.log(`target exists: ${result.filesystem.targetExists ? "yes" : "no"}`);
  console.log(`old path exists: ${result.filesystem.oldPathExists ? "yes" : "no"}`);
  console.log(`old path is symlink: ${result.filesystem.oldPathIsSymlink ? "yes" : "no"}`);
  if (result.filesystem.oldPathSymlinkTarget) {
    console.log(`old path symlink target: ${result.filesystem.oldPathSymlinkTarget}`);
  }
  console.log(`old path acceptable: ${result.filesystem.oldPathAcceptable ? "yes" : "no"}`);
  console.log(`config old path remaining: ${result.configOldPathRemaining}`);
  console.log(`global state old path remaining: ${result.globalStateOldPathRemaining}`);
  console.log(`state_5.sqlite old path rows remaining: ${result.stateDbOldPathRows}`);
  console.log(`state_5.sqlite nested new cwd rows remaining: ${result.stateDbNestedNewCwdRows}`);
  console.log(`state_5.sqlite invisible user rows remaining: ${result.stateDbInvisibleUserRows}`);
  console.log(`rollout metadata old path files remaining: ${result.rolloutMetadataOldPathFiles}`);
  console.log(`rollout metadata old path lines remaining: ${result.rolloutMetadataOldPathLines}`);
  console.log(`codex-dev.db automation old path rows remaining: ${result.automationOldPathRows}`);
  console.log(`ok: ${result.ok ? "yes" : "no"}`);
}
