import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { clientIPFor, loadGeoLocator } from './geoip.js';

const template = readFileSync(new URL('./templates/error.html', import.meta.url), 'utf8');
const locations = JSON.parse(readFileSync(new URL('./public/locations.json', import.meta.url), 'utf8'));
const assetTypes = {
  'client.js': 'text/javascript; charset=utf-8',
  'locations.json': 'application/json; charset=utf-8',
  'styles/main.css': 'text/css; charset=utf-8',
  ...Object.fromEntries(['browser', 'cloud', 'server', 'ok', 'error'].map(icon => [
    `images/cf-icon-${icon}.png`, 'image/png',
  ])),
};
const assets = new Map(Object.entries(assetTypes).map(([name, type]) => [
  `/_outage/${name}`, { type, body: readFileSync(new URL(`./public/${name}`, import.meta.url)) },
]));

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function hostnameFor(request) {
  try {
    return new URL(`http://${request.headers.host || 'localhost'}`).hostname;
  } catch {
    return 'localhost';
  }
}

export function renderPage(request, { locate = loadGeoLocator(), fallbackColo = '', trustProxy = false } = {}) {
  const hostname = hostnameFor(request);
  const ray = /^([a-f\d]{16,32})-([A-Z]{3})$/i.exec(request.headers['cf-ray'] || '');
  const clientIP = clientIPFor(request, trustProxy);
  const location = locate(clientIP);
  const colo = location?.code || fallbackColo;
  const values = {
    HOSTNAME: hostname,
    ENCODED_HOSTNAME: encodeURIComponent(hostname),
    TIMESTAMP: new Date().toISOString().slice(0, 19).replace('T', ' ') + ' UTC',
    COLO: colo,
    LOCATION: location?.city || locations[fallbackColo] || 'Cloudflare network',
    RAY_ID: ray ? ray[1].toLowerCase() : randomBytes(8).toString('hex'),
    CLIENT_IP: clientIP || 'Unavailable',
  };
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => escapeHtml(values[key] ?? ''));
}

export function createOutageServer(options = {}) {
  options = { ...options, locate: options.locate || loadGeoLocator() };
  return createServer({ requestTimeout: 15_000, headersTimeout: 10_000 }, (request, response) => {
    // Match paths against a fixed asset allowlist; arbitrary paths always get the outage page.
    const pathname = (request.url || '/').split('?')[0];
    const asset = assets.get(pathname);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader('X-Robots-Tag', 'noindex, nofollow');

    let status = 500;
    let type = 'text/html; charset=utf-8';
    let body;
    if (asset && (request.method === 'GET' || request.method === 'HEAD')) {
      ({ type, body } = asset);
      status = 200;
      response.setHeader('Cache-Control', 'public, max-age=3600');
    } else {
      response.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
      if (pathname === '/_outage/health') {
        status = 200;
        type = 'application/json; charset=utf-8';
        body = '{"status":"ok"}\n';
      } else if (pathname === '/cdn-cgi/trace' || pathname.startsWith('/_outage/')) {
        // Real Cloudflare intercepts /cdn-cgi/trace before it reaches this server.
        status = 404;
        type = 'text/plain; charset=utf-8';
        body = 'Not found\n';
      } else {
        body = renderPage(request, options);
      }
    }
    response.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) });
    response.end(request.method === 'HEAD' ? undefined : body);
    request.resume();
  });
}

export function startServer() {
  const port = Number(process.env.PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1–65535');
  const host = process.env.HOST || '0.0.0.0';
  const fallbackColo = (process.env.FALLBACK_COLO || '').trim().toUpperCase();
  if (fallbackColo && !locations[fallbackColo]) throw new Error('FALLBACK_COLO must be a known three-letter data-center code');
  const options = { fallbackColo, trustProxy: process.env.TRUST_PROXY === 'true' };
  const server = createOutageServer(options);
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, host, () => console.log(`Outage server listening on http://${host}:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      server.close(() => process.exit(0));
      setTimeout(() => { server.closeAllConnections(); process.exit(0); }, 5000).unref();
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startServer();
