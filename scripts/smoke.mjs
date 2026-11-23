// Terminal-only checks against a disposable production server; no browser involved.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
const port = process.env.SMOKE_PORT || '4317';
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', port], {env: {...process.env, PORT: port, APP_URL: origin, AUTH_SECRET: randomBytes(48).toString('base64url')}, stdio: ['ignore','pipe','pipe']});
let output = '';
child.stdout.on('data', b => { output += b.toString(); });
child.stderr.on('data', b => { output += b.toString(); });
try {
  const start = Date.now();
  while (!output.includes('Ready')) {
    if (child.exitCode !== null || Date.now() - start > 30000) throw new Error(`Production server failed to start: ${output}`);
    await new Promise(r => setTimeout(r, 100));
  }
  const login = await fetch(`${origin}/login`);
  assert.equal(login.status, 200); assert.match(await login.text(), /Welcome back/);
  assert.equal(login.headers.get('x-content-type-options'),'nosniff');
  assert.equal(login.headers.get('x-frame-options'),'DENY');
  assert.match(login.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  const dashboard = await fetch(`${origin}/dashboard`,{redirect:'manual'});
  assert.equal(dashboard.status,307);assert.equal(dashboard.headers.get('location'),'/login');
  const me = await fetch(`${origin}/api/me`);assert.equal(me.status,401);
  const csrf = await fetch(`${origin}/api/login`,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://untrusted.example'},body:JSON.stringify({username:'teacher',password:'irrelevant'})});
  assert.equal(csrf.status,403);
  console.log('Production HTTP smoke checks passed: login render, security headers, private-page redirect, anonymous API denial, CSRF rejection.');
} catch(e) {console.error(e.message, e.cause?.message || '', output);process.exitCode=1;} finally {
  child.kill('SIGTERM');
}
