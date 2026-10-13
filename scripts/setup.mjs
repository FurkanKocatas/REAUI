import { spawnSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error || result.status !== 0) { console.error(result.error?.message || `${command} failed (${result.status})`); process.exit(result.status || 1); }
}
// Do not recursively fetch REA's optional external-engine source submodules.
run('git', ['submodule', 'update', '--init', 'vendor/rea']);
const engine = join(root, 'vendor/rea');
const pinned = ['--yes', '--package=node@24.18.0', '--package=npm@11.16.0', '--call'];
run('npx', [...pinned, 'npm ci'], engine);
run('npx', [...pinned, 'npm run build:cached'], engine);
run('npm', ['run', 'build']);
console.log('\nSetup complete. Run npm start, then open http://127.0.0.1:4318');
