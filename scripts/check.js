import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const paths = ["index.js"];
for (const directory of ["foundation", "scripts", "tests/foundation"]) {
  for (const name of await readdir(directory))
    if (name.endsWith(".js")) paths.push(`${directory}/${name}`);
}
for (const path of paths) {
  const result = spawnSync(process.execPath, ["--check", path], {
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
// Resolve every static relative import in the active server graph (legacy not reachable).
const visited = new Set();
async function visit(url) {
  if (visited.has(url.href)) return;
  visited.add(url.href);
  const text = await readFile(url, "utf8");
  for (const match of text.matchAll(/(?:from\s+|import\s*)['"](\.[^'"]+)['"]/g))
    await visit(new URL(match[1], url));
}
await visit(new URL("../index.js", import.meta.url));
await import("../index.js");
console.log(
  `Syntax: ${paths.length} files. Active server import graph: ${visited.size} files. Import caused no startup.`,
);
