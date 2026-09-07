import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const script = readFileSync(new URL('../public/client.js', import.meta.url), 'utf8');
test('browser follows the page URL and reveals IP without making any network requests', () => {
  const elements = Object.fromEntries([
    'cf-host-status', 'cf-footer-ip', 'cf-footer-ip-reveal', 'cf-location',
  ].map(id => [id, { textContent: '', classList: new Set(),
    addEventListener(event, handler) { this[event] = handler; },
  }]));
  for (const element of Object.values(elements)) element.classList.remove = element.classList.delete;
  elements['cf-footer-ip'].classList.add('hidden');
  elements['cf-footer-ip'].textContent = '8.8.8.8';
  elements['cf-location'].textContent = 'Ashburn';
  const links = [{ href: 'https://www.cloudflare.com/5xx-error-landing?utm_campaign=old.example' }];
  const document = {
    getElementById: id => elements[id],
    querySelector: () => elements['cf-host-status'],
    querySelectorAll: () => links,
  };
  runInNewContext(script, {
    document, window: { location: { hostname: 'foodiebeauty.site' } }, URL,
    fetch: () => assert.fail('The browser must not make geolocation requests'),
  });
  assert.equal(elements['cf-location'].textContent, 'Ashburn');
  assert.equal(elements['cf-host-status'].textContent, 'foodiebeauty.site');
  assert.ok(document.title.startsWith('foodiebeauty.site |'));
  assert.ok(links[0].href.includes('utm_campaign=foodiebeauty.site'));
  assert.equal(elements['cf-footer-ip'].textContent, '8.8.8.8');
  elements['cf-footer-ip-reveal'].click();
  assert.ok(elements['cf-footer-ip-reveal'].classList.has('hidden'));
  assert.ok(!elements['cf-footer-ip'].classList.has('hidden'));
});
