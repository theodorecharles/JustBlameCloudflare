# Just Blame Cloudflare

A tiny, dependency-free web server that serves a simulated Cloudflare error page:
**Browser: Working → Cloudflare: Error → Host: Working**.

Uses the actual Cloudflare error-page markup, stylesheet, and icons. The page
returns HTTP **500**, fills in the current hostname and UTC timestamp, and detects
the Cloudflare data center serving the visitor. Every site URL gets the page,
including deep links and API paths. No domain list is needed in the app.

## Run

Requires Node.js 22 or newer. There are no packages to install.

```sh
git clone https://github.com/theodorecharles/JustBlameCloudflare.git
cd JustBlameCloudflare
npm start
```

Open http://localhost:8080. Set `HOST` and `PORT` to change the listening address:

```sh
HOST=127.0.0.1 PORT=8080 npm start
```

`GET /_outage/health` returns HTTP 200 for health checks. The outage page returns
HTTP 500 with `Cache-Control: no-store` so it is not retained after maintenance.
All visual assets are served locally under `/_outage/`.

## PM2

With PM2 installed:

```sh
pm2 start ecosystem.config.cjs --only just-blame-cloudflare
pm2 logs just-blame-cloudflare
```

The included configuration binds to `127.0.0.1:8080` for use behind a reverse
proxy. To stop only this app:

```sh
pm2 stop just-blame-cloudflare
```

Use your existing PM2 save/startup setup if the app should survive a reboot.

## Nginx and DNS cutover

Create a separate virtual host for each desired domain, with a valid certificate
for that hostname. See `deploy/nginx.example.conf`. Keep `proxy_intercept_errors
off` so Nginx passes the app's error page through. Preserve the original Host and
Cloudflare headers. The included PM2 setup trusts Nginx's `X-Real-IP` header;
only enable `TRUST_PROXY=true` when the app is behind your own proxy.

If changing Cloudflare DNS directly to this server, install and verify the
hostname's certificate **before** cutover. Cloudflare Full (strict) validates
the origin certificate; otherwise Cloudflare may return its own 525/526 page
before this app receives the request. Keep the existing Cloudflare proxy/SSL
settings and change only the intended origin record. Check for an old AAAA
record if some traffic still reaches the previous server.

Test the destination without changing public DNS:

```sh
curl --resolve example.com:443:YOUR_SERVER_IP https://example.com/
```

Expect the simulated HTML and HTTP 500. An Nginx Proxy Manager deployment can
also retain its existing certificates and forward selected sites to this app
instead of changing DNS. Expose the app only on an interface reachable by that
proxy in that setup.

`deploy/install-nginx.sh` installs a **separately prepared**, private deployment
bundle from `.deployment/`. It requires root, validates certificates and Nginx
configuration, and adds only `just-blame-cloudflare.conf`. Existing site files
are preserved. It does not change DNS or other PM2 processes. Private deployment
bundles and keys are intentionally excluded from version control.

## Data-center detection

The server reads the data-center suffix from Cloudflare's incoming `CF-Ray`
header and translates it using the bundled map (for example, `IAD` → `Ashburn`).
The browser also checks the site's `/cdn-cgi/trace`, which identifies the
visitor's ingress edge even when Argo changes the origin-facing Ray ID's suffix.

For direct access without Cloudflare in front, the browser checks
`https://www.cloudflare.com/cdn-cgi/trace` from the visitor's network. A startup
probe from the server supplies a fallback if visitor detection is unavailable.
Requests time out quickly; lookup failures do not stop the page from rendering.
The location is the edge selected by Cloudflare's routing, which may differ from
the geographically closest city. This lookup does **not** detect a real outage:
the error indicator is always simulated.

The footer uses the request's real Ray ID when available and a generated ID
otherwise. The hostname follows the browser's current URL, including when a
reverse proxy changes the upstream Host header.

References: [Cloudflare HTTP headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/)
and [Cloudflare network locations](https://www.cloudflarestatus.com/locations).

## Tests and license

```sh
npm test
```

The original project code is MIT-licensed. Cloudflare-sourced assets and markup
are covered separately in [THIRD_PARTY.md](THIRD_PARTY.md).
