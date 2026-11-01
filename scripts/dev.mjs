// Runs the whole dev stack with one command: Postgres (Docker), api and web.
// Usage: npm run dev [-- --no-db]
import { spawn, spawnSync } from 'node:child_process';

const COLORS = { api: '\x1b[36m', web: '\x1b[35m', dev: '\x1b[33m' };
const RESET = '\x1b[0m';

function log(name, line) {
  process.stdout.write(`${COLORS[name] ?? ''}[${name}]${RESET} ${line}\n`);
}

function startDatabase() {
  log('dev', 'starting Postgres via docker compose…');
  const result = spawnSync('docker', ['compose', 'up', '-d', '--wait', 'db'], { stdio: 'inherit' });
  if (result.error?.code === 'ENOENT') {
    log('dev', 'docker not found; skipping. Make sure DATABASE_URL points to a running Postgres.');
  } else if (result.status !== 0) {
    log('dev', 'docker compose failed; continuing without starting the database.');
  }
}

function run(name, workspace) {
  const child = spawn('npm', ['run', 'dev', '-w', workspace], {
    stdio: ['ignore', 'pipe', 'pipe'],
    // Own process group, so shutdown can signal npm *and* the processes it spawned.
    detached: true,
    env: { ...process.env, FORCE_COLOR: '1' },
  });
  for (const stream of [child.stdout, child.stderr]) {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) log(name, line);
    });
  }
  return child;
}

if (!process.argv.includes('--no-db')) startDatabase();

const children = [run('api', '@tempo/api'), run('web', '@tempo/web')];
let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // Group already gone.
    }
  }
  process.exitCode = code;
}

for (const child of children) {
  child.on('exit', (code) => shutdown(code ?? 1));
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
