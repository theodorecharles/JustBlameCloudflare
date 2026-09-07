# Just Blame Cloudflare

A tiny, dependency-free web server that serves a simulated Cloudflare error page:
**Browser: Working → Cloudflare: Error → Host: Working**.

Uses the actual Cloudflare error-page markup, stylesheet, and icons. The page
returns HTTP **500**, fills in the current hostname and UTC timestamp, and detects
the Cloudflare data center serving the visitor. Every site URL gets the page,
including deep links and API paths. No domain list is needed in the app.

## Docker and Unraid

The public image supports `linux/amd64` and `linux/arm64`:

```sh
docker run -d \
  --name just-blame-cloudflare \
  --restart unless-stopped \
  --read-only --cap-drop=ALL --security-opt=no-new-privileges:true \
  -p 18080:8080 \
  ghcr.io/theodorecharles/just-blame-cloudflare:latest
```

Open `http://YOUR_SERVER_IP:18080`. No volumes, certificates, or domain settings
are required. The container serves **plain HTTP only** on port 8080. Use your
own Nginx, Nginx Proxy Manager, Caddy, Traefik, or other reverse proxy for HTTPS
and domain routing. The container does not configure your proxy or change DNS.

With Docker Compose, use the included `compose.yaml` and run
`docker compose up -d`. Change its published port if 18080 is already in use.

For Unraid, the canonical template is
[just-blame-cloudflare.xml](https://github.com/theodorecharles/unraid-templates/blob/master/just-blame-cloudflare.xml)
in the Community Apps templates repository. Once indexed, search for
**just-blame-cloudflare** in Apps. To install manually before indexing, run this
in an Unraid terminal:

```sh
curl --fail --location \
  --output /boot/config/plugins/dockerMan/templates-user/my-just-blame-cloudflare.xml \
  https://raw.githubusercontent.com/theodorecharles/unraid-templates/master/just-blame-cloudflare.xml
```

Then choose **Docker → Add Container → just-blame-cloudflare**, select an unused
host port, and apply. Click WebUI to preview it. Point selected proxy hosts at
the Unraid server's mapped HTTP port to use the page for their domains.
For a Docker network shared with your proxy, the upstream can instead be
`http://just-blame-cloudflare:8080`.

Keep the original Host and Cloudflare headers when proxying. For Nginx, keep
`proxy_intercept_errors off` so the intentional HTTP 500 body reaches visitors.
The optional advanced `TRUST_PROXY=true` setting trusts your proxy's `X-Real-IP`
header for the footer. Leave it false unless visitors can only reach the
container through that trusted proxy. Hostname detection works either way.

The image runs as the unprivileged `node` user, works with a read-only filesystem,
and has a health check against `/_outage/health`. A healthy container deliberately
returns HTTP 500 for ordinary page requests.

Images are rebuilt after tests pass on `main`, on version tags, and weekly to
pick up Node/Alpine base-image updates. `latest` tracks main; version tags such
as `1.1.0` and commit tags such as `sha-abcdef0` are also published.

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
docker build -t just-blame-cloudflare:test .
node scripts/smoke-container.mjs just-blame-cloudflare:test
```

The original project code is MIT-licensed. Cloudflare-sourced assets and markup
are covered separately in [THIRD_PARTY.md](THIRD_PARTY.md).
