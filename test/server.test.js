import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { createOutageServer, renderPage } from '../server.js';
import { createGeoLocator } from '../geoip.js';

const coordinates = {
  '9.9.9.9': { latitude: 39.0438, longitude: -77.4874 },
  '8.8.8.8': { latitude: 51.5074, longitude: -0.1278 },
  '1.1.1.1': { latitude: 35.6762, longitude: 139.6503 },
};
const locate = createGeoLocator({ get: ip => ({ location: coordinates[ip] }) });

let server;
let origin;
before(async () => {
  server = createOutageServer({ trustProxy: true, locate });
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

test('hostname and offline GeoIP are resolved independently with no Cloudflare headers', async () => {
  for (const [hostname, ip, city] of [
    ['games-dev.tedcharles.net', '9.9.9.9', 'Ashburn'],
    ['foodiebeauty.site', '8.8.8.8', 'London'],
    ['any-other.example', '1.1.1.1', 'Tokyo'],
  ]) {
    const response = await rawRequest('/', {
      host: hostname, 'x-real-ip': ip,
    });
    const html = response.body;
    assert.ok(html.includes(`<title>${hostname} |`));
    assert.ok(html.includes(`id="cf-location">${city}</span>`));
    assert.ok(html.includes(`id="cf-footer-ip">${ip}`));
    assert.match(html, /href="https:\/\/db-ip.com"/);
  }
});

test('CF-Ray is decorative only and cannot determine the GeoIP location', async () => {
  const response = await rawRequest('/', { 'x-real-ip': '8.8.8.8', 'cf-ray': '0123456789abcdef-IAD' });
  assert.match(response.body, /id="cf-location">London/);
  assert.match(response.body, /font-semibold">0123456789abcdef/);
  const unknown = await (await fetch(origin, { headers: { 'cf-ray': '0123456789abcdef-ZZZ' } })).text();
  assert.match(unknown, /id="cf-location">Cloudflare network/);
});

test('malformed metadata is ignored and cannot leak between requests', async () => {
  const unsafe = (await rawRequest('/', {
    host: '<script>.example', 'cf-ray': '<img src=x onerror=alert(1)>',
    'cf-connecting-ip': '<svg onload=alert(1)>', 'x-forwarded-host': 'evil.example',
  })).body;
  assert.doesNotMatch(unsafe, /<img|<svg|<script>\.example|evil\.example/);
  assert.match(unsafe, /data-colo=""/);
  const fresh = await (await fetch(origin)).text();
  assert.doesNotMatch(fresh, /203\.0\.113\.5|0123456789abcdef/);
});

test('direct requests use the socket IP; unknown addresses have an optional fallback', () => {
  const request = { headers: { host: 'direct.example', 'x-real-ip': '8.8.8.8',
    'cf-connecting-ip': '8.8.8.8' }, socket: { remoteAddress: '9.9.9.9' } };
  assert.match(renderPage(request, { locate }), /id="cf-location">Ashburn/);
  request.socket.remoteAddress = '192.168.1.5';
  assert.match(renderPage(request, { locate }), /id="cf-location">Cloudflare network/);
  assert.match(renderPage(request, { locate, fallbackColo: 'LHR' }), /id="cf-location">London/);
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
