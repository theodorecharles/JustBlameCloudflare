import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const script = readFileSync(new URL('../public/client.js', import.meta.url), 'utf8');
async function runClient({ colo = '', responses = {} } = {}) {
  const elements = Object.fromEntries([
    'cf-host-status', 'cf-footer-ip', 'cf-footer-ip-reveal', 'cf-location', 'cf-wrapper',
  ].map(id => [id, { textContent: '', dataset: {}, classList: new Set(),
    addEventListener(event, handler) { this[event] = handler; },
  }]));
  for (const element of Object.values(elements)) element.classList.remove = element.classList.delete;
  elements['cf-footer-ip'].classList.add('hidden');
  elements['cf-wrapper'].dataset.colo = colo;
  elements['cf-location'].textContent = colo === 'IAD' ? 'Ashburn' : 'Detecting…';
  const links = [{ href: 'https://www.cloudflare.com/5xx-error-landing?utm_campaign=old.example' }];
  const document = {
    getElementById: id => elements[id],
    querySelector: () => elements['cf-host-status'],
    querySelectorAll: () => links,
  };
  const calls = [];
  runInNewContext(script, {
    document, window: { location: { hostname: 'foodiebeauty.site' } },
    URL, AbortController, setTimeout, clearTimeout,
    fetch: async url => {
      calls.push(url);
      const value = responses[url];
      if (value instanceof Error) throw value;
      return { ok: value !== undefined, text: async () => value, json: async () => value };
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  return { elements, document, calls, links };
}

test('visitor trace corrects an origin-side Argo colo and hostname follows browser URL', async () => {
  const { elements, document, calls, links } = await runClient({ colo: 'IAD', responses: {
    '/cdn-cgi/trace': 'colo=LHR\nip=203.0.113.8\n', '/_outage/locations.json': { LHR: 'London' },
  } });
  assert.equal(elements['cf-location'].textContent, 'London');
  assert.equal(elements['cf-host-status'].textContent, 'foodiebeauty.site');
  assert.match(document.title, /^foodiebeauty\.site/);
  assert.match(links[0].href, /utm_campaign=foodiebeauty.site/);
  assert.equal(elements['cf-footer-ip'].textContent, '203.0.113.8');
  assert.ok(!calls.includes('https://www.cloudflare.com/cdn-cgi/trace'));
  elements['cf-footer-ip-reveal'].click();
  assert.ok(elements['cf-footer-ip-reveal'].classList.has('hidden'));
  assert.ok(!elements['cf-footer-ip'].classList.has('hidden'));
});

test('direct-origin access uses visitor-side Cloudflare trace', async () => {
  const { elements, calls } = await runClient({ responses: {
    'https://www.cloudflare.com/cdn-cgi/trace': 'colo=IAD\nip=203.0.113.9\n',
    '/_outage/locations.json': { IAD: 'Ashburn' },
  } });
  assert.equal(elements['cf-location'].textContent, 'Ashburn');
  assert.deepEqual(calls, ['/cdn-cgi/trace', 'https://www.cloudflare.com/cdn-cgi/trace', '/_outage/locations.json']);
});

test('failed lookups keep a known request location and cannot leave a loading label forever', async () => {
  const known = await runClient({ colo: 'IAD' });
  assert.equal(known.elements['cf-location'].textContent, 'Ashburn');
  assert.deepEqual(known.calls, ['/cdn-cgi/trace']);
  const missing = await runClient({ responses: { '/cdn-cgi/trace': new Error('timeout') } });
  assert.equal(missing.elements['cf-location'].textContent, 'Cloudflare network');
});
