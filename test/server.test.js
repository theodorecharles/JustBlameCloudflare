import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { createOutageServer } from '../server.js';

let server;
let origin;
before(async () => {
  server = createOutageServer({ trustProxy: true });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(resolve => server.close(resolve)));

// Use raw HTTP for Host headers and literal paths: fetch normalizes both.
function rawRequest(path, headers = {}) {
  return new Promise((resolve, reject) => {
    request(origin, { path, headers }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    }).on('error', reject).end();
  });
}

test('all site routes and methods return the error page with HTTP 500 and no caching', async () => {
  for (const [path, method] of [['/', 'GET'], ['/games/lobby?x=1', 'GET'], ['/api/upload', 'POST']]) {
    const response = await fetch(origin + path, { method });
    const html = await response.text();
    assert.equal(response.status, 500);
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.match(html, /Internal server error/);
    assert.doesNotMatch(html, /\{\{[A-Z_]+\}\}/);
    assert.match(html, /id="cf-cloudflare-status" class="cf-error-source/);
    const cloud = html.split('id="cf-cloudflare-status"')[1].split('id="cf-host-status"')[0];
    const host = html.split('id="cf-host-status"')[1].split('What happened?')[0];
    assert.match(cloud, /cf-icon-error/);
    assert.match(cloud, /text-red-error">Error/);
    assert.match(host, /cf-icon-ok/);
    assert.match(host, /text-green-success">Working/);
    assert.doesNotMatch(host, /cf-error-source|cf-icon-error/);
  }
});

test('hostname and Cloudflare metadata are resolved independently for each request', async () => {
  for (const [hostname, colo, city] of [
    ['games-dev.tedcharles.net', 'IAD', 'Ashburn'],
    ['foodiebeauty.site', 'LHR', 'London'],
    ['any-other.example', 'NRT', 'Tokyo'],
  ]) {
    const response = await rawRequest('/', {
      host: hostname, 'cf-ray': `0123456789abcdef-${colo}`, 'cf-connecting-ip': '203.0.113.5',
    });
    const html = response.body;
    assert.ok(html.includes(`<title>${hostname} |`));
    assert.ok(html.includes(`id="cf-location">${city}</span>`));
    assert.ok(html.includes(`data-colo="${colo}"`));
    assert.match(html, /font-semibold">0123456789abcdef/);
    assert.match(html, /id="cf-footer-ip">203\.0\.113\.5/);
  }
});

test('unknown data centers display their code and malformed metadata is ignored', async () => {
  const unknown = await (await fetch(origin, { headers: { 'cf-ray': '0123456789abcdef-ZZZ' } })).text();
  assert.match(unknown, /id="cf-location">ZZZ/);
  const unsafe = (await rawRequest('/', {
    host: '<script>.example', 'cf-ray': '<img src=x onerror=alert(1)>',
    'cf-connecting-ip': '<svg onload=alert(1)>', 'x-forwarded-host': 'evil.example',
  })).body;
  assert.doesNotMatch(unsafe, /<img|<svg|<script>\.example|evil\.example/);
  assert.match(unsafe, /data-colo=""/);
  const fresh = await (await fetch(origin)).text();
  assert.doesNotMatch(fresh, /203\.0\.113\.5|0123456789abcdef/);
});

test('HEAD preserves status and length without sending the page body', async () => {
  const response = await fetch(origin + '/deep/path', { method: 'HEAD' });
  assert.equal(response.status, 500);
  assert.ok(Number(response.headers.get('content-length')) > 1000);
  assert.equal(await response.text(), '');
});

test('bundled styles, icons, location map and script work independently of Cloudflare', async () => {
  const css = await fetch(origin + '/_outage/styles/main.css');
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);
  const text = await css.text();
  assert.match(text, /max-width:720px/);
  assert.doesNotMatch(text, /url\(\/cdn-cgi\//);
  for (const match of text.matchAll(/url\(([^)]+)\)/g)) {
    const image = await fetch(origin + match[1]);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.equal(Buffer.from(await image.arrayBuffer()).subarray(1, 4).toString(), 'PNG');
  }
  const locations = await (await fetch(origin + '/_outage/locations.json')).json();
  assert.equal(locations.IAD, 'Ashburn');
  assert.ok(Object.keys(locations).length > 300);
  assert.equal((await fetch(origin + '/_outage/client.js')).status, 200);
});

test('health is healthy, unavailable trace and unknown private assets return 404', async () => {
  const health = await fetch(origin + '/_outage/health');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });
  for (const path of ['/cdn-cgi/trace', '/_outage/missing', '/_outage/%2e%2e/server.js']) {
    assert.equal((await rawRequest(path)).status, 404);
  }
});
