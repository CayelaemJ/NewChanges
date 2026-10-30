// Dedicated synthetic-only Render MFA staging entrypoint. Never connect this
// entrypoint to an existing application database or enable automatic workers.
import { spawnSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';

const expectedHost = 'dpg-dbib30142hec73cus92g-a';
const expectedDatabase = 'newchanges_mfa_synthetic_staging_db';
const expectedOrigin = 'https://newchanges-mfa-isolated-staging.onrender.com';
const expectedRpId = 'newchanges-mfa-isolated-staging.onrender.com';
const port = Number(process.env.PORT || 3000);

function syntheticConfigIsSafe() {
  if (process.env.MFA_STAGING_ONLY !== 'true' ||
      process.env.MFA_STAGING_SYNTHETIC_ONLY !== 'true' ||
      process.env.STANDBY_MODE !== 'true' ||
      process.env.TRAFFIC_SAVER_MODE !== 'true' ||
      !['false','true'].includes(process.env.ADMIN_MFA_ENFORCE) ||
      (process.env.ADMIN_MFA_ENFORCE === 'true' &&
        process.env.MFA_STAGING_ENFORCEMENT_APPROVED !== 'true') ||
      process.env.COOKIE_SECURE !== 'true' ||
      process.env.MFA_RP_ID !== expectedRpId ||
      process.env.MFA_EXPECTED_ORIGIN !== expectedOrigin) return false;
  const password = process.env.MFA_STAGING_GATE_PASSWORD;
  const raw = process.env.DATABASE_URL;
  if (!raw || !password || Buffer.byteLength(password, 'utf8') < 24 ||
      Buffer.byteLength(password, 'utf8') > 256) return false;
  try {
    const u = new URL(raw);
    const hostname = u.hostname.toLowerCase();
    return ['postgresql:','postgres:'].includes(u.protocol) &&
      decodeURIComponent(u.pathname) === '/' + expectedDatabase &&
      (hostname === expectedHost ||
        (hostname.startsWith(expectedHost + '.') && hostname.endsWith('.render.com')));
  } catch { return false; }
}

function locked() {
  createServer((req, res) => {
    res.writeHead(req.url === '/health' ? 200 : 503, {
      'Content-Type':'text/plain; charset=utf-8',
      'Cache-Control':'no-store',
      'X-Robots-Tag':'noindex, nofollow',
      'X-Content-Type-Options':'nosniff',
    });
    res.end(req.url === '/health' ? 'Staging startup gate active' :
      'Synthetic MFA staging is locked until isolated database and access credentials are configured.');
  }).listen(port,'0.0.0.0');
}

if (!syntheticConfigIsSafe()) {
  process.stderr.write('Synthetic MFA staging locked: credentials or isolated configuration missing.\n');
  locked();
} else {
  // Only the exact disposable database above is eligible for schema setup.
  // Do not pass --accept-data-loss or --force-reset.
  const migration = spawnSync('node',['node_modules/prisma/build/index.js','db','push'],{
    env:process.env,encoding:'utf8',timeout:120000,maxBuffer:2*1024*1024,
  });
  if (migration.status !== 0) {
    process.stderr.write('Synthetic MFA staging schema setup did not succeed. Refusing to start.\n');
    locked();
  } else {
    process.stdout.write('Synthetic MFA staging schema ready; launching application.\n');
    const server = spawn('node',['dist/server.js'],{stdio:'inherit',env:process.env});
    for (const signal of ['SIGTERM','SIGINT'])
      process.on(signal,()=>server.kill(signal));
    server.on('exit',(code)=>process.exit(code ?? 1));
  }
}
