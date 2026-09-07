import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientIPFor, createGeoLocator, loadGeoLocator, nearestLocation, normalizeIP } from '../geoip.js';

test('great-circle distance finds nearby cities around the world', () => {
  for (const [latitude, longitude, city] of [
    [39.0438, -77.4874, 'Ashburn'], [51.5074, -0.1278, 'London'],
    [-33.8688, 151.2093, 'Sydney'], [35.6762, 139.6503, 'Tokyo'],
    [-33.9249, 18.4241, 'Cape Town'], [-23.5505, -46.6333, 'São Paulo'],
  ]) assert.equal(nearestLocation(latitude, longitude).city, city);
  for (const coords of [[undefined, undefined], [NaN, 0], [91, 0], [0, 181], ['0', '0']]) {
    assert.equal(nearestLocation(...coords), null);
  }
  assert.equal(nearestLocation(0, 179, [
    { code: 'FAR', latitude: 0, longitude: 150 },
    { code: 'NEAR', latitude: 0, longitude: -179 },
  ]).code, 'NEAR');
});

test('IPv4, IPv6, missing coordinates, and reserved IPs are handled locally', () => {
  const calls = [];
  const locate = createGeoLocator({ get: ip => {
    calls.push(ip);
    return ip === '9.9.9.9' ? null : { location: { latitude: 51.5074, longitude: -0.1278 } };
  } });
  for (const ip of ['8.8.8.8', '::ffff:8.8.8.8', '2001:4860:4860::8888']) {
    assert.equal(locate(ip).city, 'London');
  }
  assert.equal(locate('9.9.9.9'), null);
  const publicCalls = calls.length;
  for (const ip of ['', 'bad', '127.0.0.1', '10.0.0.1', '172.17.0.1', '192.168.1.1',
    '100.64.0.1', '169.254.1.1', '203.0.113.5', '::1', 'fc00::1', 'fe80::1', 'ff02::1',
    '2001:db8::1', '::ffff:192.168.1.1', '::ffff:c0a8:101']) assert.equal(locate(ip), null, ip);
  assert.equal(calls.length, publicCalls, 'reserved IPs must not query the database');
});

test('proxy trust is opt-in and does not trust the leftmost user-controlled XFF', () => {
  const request = { headers: { 'x-real-ip': '8.8.8.8', 'x-forwarded-for': '1.1.1.1, 9.9.9.9',
    'cf-connecting-ip': '1.0.0.1' }, socket: { remoteAddress: '::ffff:10.0.0.2' } };
  assert.equal(clientIPFor(request), '10.0.0.2');
  assert.equal(clientIPFor(request, true), '8.8.8.8');
  delete request.headers['x-real-ip'];
  assert.equal(clientIPFor(request, true), '9.9.9.9');
  request.headers['x-forwarded-for'] = '8.8.8.8, invalid';
  assert.equal(clientIPFor(request, true), '10.0.0.2');
  request.headers['x-real-ip'] = '<svg onload=alert(1)>';
  assert.equal(clientIPFor(request, true), '10.0.0.2');
  assert.equal(normalizeIP('::ffff:8.8.8.8'), '8.8.8.8');
});

test('the actual bundled MMDB resolves IPv4 and IPv6 without external services', () => {
  const locate = loadGeoLocator();
  assert.equal(loadGeoLocator(), locate, 'the database is loaded once');
  for (const ip of ['8.8.8.8', '2001:4860:4860::8888']) {
    assert.match(locate(ip).code, /^[A-Z]{3}$/);
    assert.ok(locate(ip).city);
  }
  assert.equal(locate('::ffff:8.8.8.8').code, locate('8.8.8.8').code);
  assert.equal(locate('127.0.0.1'), null);
});
