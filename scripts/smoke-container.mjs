import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { request } from 'node:http';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const exec = promisify(execFile);
const docker = async (...args) => (await exec('docker', args, { timeout: 30_000 })).stdout.trim();
const image = process.argv[2] || 'just-blame-cloudflare:test';
let container;
let offlineContainer;

function get(url, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers, method }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks),
      }));
    });
    req.setTimeout(3000, () => req.destroy(new Error('Request timed out')));
    req.on('error', reject).end();
  });
}

try {
  container = await docker('run', '-d', '--read-only', '--cap-drop=ALL',
    '--security-opt=no-new-privileges:true', '--health-interval=1s', '--health-start-period=1s',
    '-e', 'TRUST_PROXY=true', '-p', '127.0.0.1::8080', image);
  const port = await docker('port', container, '8080/tcp');
  const origin = `http://${port}`;
  let healthy = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    const status = await docker('inspect', '--format', '{{.State.Health.Status}}', container);
    if (status === 'healthy') { healthy = true; break; }
    await delay(250);
  }
  assert.ok(healthy, 'container should become healthy even though site routes return HTTP 500');
  assert.equal(await docker('inspect', '--format', '{{.Config.User}}', container), 'node');

  const response = await get(`${origin}/deep/link?test=1`, {
    Host: 'maintenance.example', 'X-Real-IP': '8.8.8.8',
  });
  const html = response.body.toString();
  assert.equal(response.status, 500);
  assert.match(response.headers['cache-control'], /no-store/);
  assert.match(html, /<title>maintenance\.example \|/);
  assert.match(html, /id="cf-location">San Jose/);
  assert.match(html, /IP Geolocation by DB-IP/);
  const cloud = html.split('id="cf-cloudflare-status"')[1].split('id="cf-host-status"')[0];
  assert.match(cloud, /cf-icon-error/);
  assert.match(cloud, /text-red-error">Error/);
  const head = await get(origin, {}, 'HEAD');
  assert.equal(head.status, 500);
  assert.equal(head.body.length, 0);
  assert.equal((await get(`${origin}/_outage/styles/main.css`)).status, 200);
  const icon = await get(`${origin}/_outage/images/cf-icon-cloud.png`);
  assert.equal(icon.status, 200);
  assert.equal(icon.body.subarray(1, 4).toString(), 'PNG');
  const files = JSON.parse(await docker('exec', container, 'node', '-e',
    'console.log(JSON.stringify(require("node:fs").readdirSync("/app")))'));
  assert.deepEqual(files.sort(), ['LICENSE', 'THIRD_PARTY.md', 'data', 'geoip.js', 'node_modules', 'package.json', 'public', 'server.js', 'start.js', 'templates'].sort());
  await docker('stop', '--time', '6', container);
  assert.equal(await docker('inspect', '--format', '{{.State.ExitCode}}', container), '0');
  // A second instance starts with no external network interface at all. Its local
  // request must still render a location from the bundled IPv6 database.
  offlineContainer = await docker('run', '-d', '--network=none', '--read-only', '--cap-drop=ALL',
    '--security-opt=no-new-privileges:true', '-e', 'TRUST_PROXY=true', image);
  await docker('exec', offlineContainer, 'node', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { setTimeout as delay } from 'node:timers/promises';
    let response;
    for (let i = 0; i < 40; i++) {
      try {
        response = await fetch('http://127.0.0.1:8080/', { headers: { 'X-Real-IP': '2001:4860:4860::8888' } });
        break;
      } catch { await delay(100); }
    }
    assert.equal(response?.status, 500);
    assert.ok((await response.text()).includes('id="cf-location">Montréal'));
  `);
  await docker('stop', '--time', '6', offlineContainer);
  assert.equal(await docker('inspect', '--format', '{{.State.ExitCode}}', offlineContainer), '0');
  console.log('Container smoke test passed: offline IPv4/IPv6 GeoIP, healthy, non-root, read-only, correct page/assets, clean shutdown.');
} finally {
  if (container) await docker('rm', '-f', container);
  if (offlineContainer) await docker('rm', '-f', offlineContainer);
}
