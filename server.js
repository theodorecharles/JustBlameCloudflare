import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';

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

export function renderPage(request, { fallbackColo = '', trustProxy = false } = {}) {
  const hostname = hostnameFor(request);
  const ray = /^([a-f\d]{16,32})-([A-Z]{3})$/i.exec(request.headers['cf-ray'] || '');
  const colo = ray ? ray[2].toUpperCase() : fallbackColo;
  const forwardedIP = trustProxy ? request.headers['x-real-ip'] : undefined;
  const clientIP = [request.headers['cf-connecting-ip'], forwardedIP, request.socket.remoteAddress]
    .find(value => typeof value === 'string' && isIP(value)) || 'Unavailable';
  const values = {
    HOSTNAME: hostname,
    ENCODED_HOSTNAME: encodeURIComponent(hostname),
    TIMESTAMP: new Date().toISOString().slice(0, 19).replace('T', ' ') + ' UTC',
    COLO: ray ? colo : '',
    LOCATION: locations[colo] || colo || 'Detecting…',
    RAY_ID: ray ? ray[1].toLowerCase() : randomBytes(8).toString('hex'),
    CLIENT_IP: clientIP.replace(/^::ffff:/, ''),
  };
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => escapeHtml(values[key] ?? ''));
}

export async function detectServerColo() {
  try {
    const response = await fetch('https://www.cloudflare.com/cdn-cgi/trace', {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return '';
    return /^colo=([A-Z]{3})$/m.exec(await response.text())?.[1] || '';
  } catch {
    return '';
  }
}

export function createOutageServer(options = {}) {
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
  const options = { fallbackColo: '', trustProxy: process.env.TRUST_PROXY === 'true' };
  const server = createOutageServer(options);
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, host, () => console.log(`Outage server listening on http://${host}:${port}`));
  // Never delay startup or page rendering on an external service.
  detectServerColo().then(colo => { options.fallbackColo = colo; });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      server.close(() => process.exit(0));
      setTimeout(() => { server.closeAllConnections(); process.exit(0); }, 5000).unref();
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startServer();
