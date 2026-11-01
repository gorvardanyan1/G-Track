// Runs the Cypress suites. Usage: node scripts/cypress.mjs [e2e|component|all] [-- cypress args]
//   component: mounts components in a browser (no servers needed)
//   e2e:       seeds a throwaway database, starts its own api + web, runs the e2e specs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const webDir = `${root}apps/web`;
const [mode = 'all', ...rest] = process.argv.slice(2);
const extraArgs = rest[0] === '--' ? rest.slice(1) : rest;
if (!['e2e', 'component', 'all'].includes(mode)) {
  process.stderr.write(`unknown mode "${mode}" (e2e | component | all)\n`);
  process.exit(2);
}

// Separate from the Playwright run (its own database, ports and outbox).
process.env['E2E_DATABASE_URL'] ??= 'postgresql://tempo:tempo@localhost:5434/tempo_cypress_e2e';
process.env['E2E_API_PORT'] ??= '3200';
process.env['E2E_WEB_PORT'] ??= '5274';
process.env['E2E_OUTBOX_DIR'] ??= `${webDir}/cypress/.outbox`;

const children = [];
const log = (line) => process.stdout.write(`\x1b[33m[cypress]\x1b[0m ${line}\n`);

function start(name, command, args, options) {
  const child = spawn(command, args, {
    ...options,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (d) => (output += d));
  child.on('exit', (code) => {
    if (code !== null && code !== 0 && !stopping) {
      process.stderr.write(`[${name}] exited with ${code}\n${output.slice(-4000)}\n`);
    }
  });
  children.push(child);
  return child;
}

let stopping = false;
function stopAll() {
  stopping = true;
  for (const child of children) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => (stopAll(), process.exit(1)));

async function waitFor(url, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`timed out waiting for ${url}`);
}

/** Cypress' Electron must not run in Node mode (VS Code terminals set ELECTRON_RUN_AS_NODE). */
function cypressEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env['ELECTRON_RUN_AS_NODE'];
  return env;
}

function runCypress(type, env) {
  return new Promise((resolve) => {
    // Chrome (installed locally and on CI runners); Cypress' bundled Electron is deprecated.
    const browser = process.env['CYPRESS_BROWSER'] ?? 'chrome';
    const child = spawn(
      'npx',
      ['cypress', 'run', `--${type}`, '--browser', browser, ...extraArgs],
      {
        cwd: webDir,
        stdio: 'inherit',
        env: cypressEnv(env),
      },
    );
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

async function runE2e() {
  const { E2E, WEB_URL, API_URL, apiEnv } = await import('../e2e/support/env.ts');
  const { default: globalSetup } = await import('../e2e/global-setup.ts');
  log(`preparing ${new URL(E2E.databaseUrl).pathname.slice(1)} (migrate + seed)…`);
  await globalSetup();

  log(`starting api on :${E2E.apiPort} and web on :${E2E.webPort}…`);
  start('api', 'node', ['src/server.ts'], {
    cwd: `${root}apps/api`,
    // Each spec poses as its own client IP (X-Forwarded-For), like users behind one proxy, so
    // per-IP rate limits don't leak between specs. Exactly one trusted hop, as in production.
    env: { ...process.env, ...apiEnv({ TRUST_PROXY: '1' }) },
  });
  start('web', 'npx', ['vite', '--port', String(E2E.webPort), '--strictPort'], {
    cwd: webDir,
    env: { ...process.env, API_PROXY_TARGET: `http://localhost:${E2E.apiPort}` },
  });
  await waitFor(`${API_URL}/health`);
  await waitFor(WEB_URL);

  return runCypress('e2e', {
    CYPRESS_BASE_URL: WEB_URL,
    CYPRESS_API_URL: API_URL,
    // The browser runs in New York; seeded profiles are in Berlin, Yerevan and New York.
    TZ: 'America/New_York',
  });
}

let code = 0;
try {
  if (mode === 'component' || mode === 'all') {
    log('component tests…');
    // Run every suite even if an earlier one failed; exit non-zero if any did.
    code = (await runCypress('component', {})) || code;
  }
  if (mode === 'e2e' || mode === 'all') {
    log('e2e tests…');
    code = (await runE2e()) || code;
  }
} catch (err) {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  code = 1;
} finally {
  stopAll();
}
process.exit(code);
