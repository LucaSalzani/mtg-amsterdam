import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DIST_DIR = path.join(ROOT, "dist");
const WEB_DIR = path.join(ROOT, "web");
const DATA_DIR = path.join(ROOT, "data");

async function cleanDir(targetPath) {
  await fs.rm(targetPath, { recursive: true, force: true });
  await fs.mkdir(targetPath, { recursive: true });
}

async function copyRecursive(sourcePath, targetPath) {
  await fs.mkdir(targetPath, { recursive: true });
  await fs.cp(sourcePath, targetPath, { recursive: true });
}

async function main() {
  await cleanDir(DIST_DIR);
  await copyRecursive(WEB_DIR, path.join(DIST_DIR, "web"));
  await fs.mkdir(path.join(DIST_DIR, "data"), { recursive: true });
  await fs.copyFile(
    path.join(DATA_DIR, "events.normalized.json"),
    path.join(DIST_DIR, "data", "events.normalized.json")
  );
  await fs.copyFile(path.join(WEB_DIR, "index.html"), path.join(DIST_DIR, "index.html"));
  await fs.writeFile(path.join(DIST_DIR, ".nojekyll"), "", "utf8");
  console.log(`Exported static site to ${DIST_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
