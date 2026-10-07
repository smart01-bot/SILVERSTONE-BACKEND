import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const files = ['app.js', 'index.js', 'jest.config.js'];
for (const directory of ['config', 'controllers', 'middleware', 'models', 'routes', 'services', 'scripts']) {
  for (const name of await readdir(directory)) if (name.endsWith('.js')) files.push(`${directory}/${name}`);
}
for (const file of files) {
  if (spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' }).status !== 0) process.exit(1);
}
const visited = new Set();
async function visit(url) {
  if (visited.has(url.href)) return;
  visited.add(url.href);
  const source = await readFile(url, 'utf8');
  for (const match of source.matchAll(/(?:from\s+|import\s*)['"](\.[^'"]+)['"]/g)) {
    const child = new URL(match[1], url);
    if (child.pathname.endsWith('.js')) await visit(child);
  }
}
await visit(new URL('../app.js', import.meta.url));
// Only app.js is imported: no listener, database connection or Redis connection.
await import('../app.js');
console.log(`Syntax checked ${files.length} files; active app graph ${visited.size} files loaded without startup.`);
