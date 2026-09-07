# Just Blame Cloudflare

A small web server that serves a simulated Cloudflare error page:
**Browser: Working → Cloudflare: Error → Host: Working**.

Uses the actual Cloudflare error-page markup, stylesheet, and icons. The page
returns HTTP **500**, fills in the current hostname and UTC timestamp, and estimates
the nearest Cloudflare city using a bundled GeoIP database. Cloudflare is not
required, and no external services are contacted at runtime. Every site URL gets the page,
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

Keep the original Host header when proxying. For Nginx, keep
`proxy_intercept_errors off` so the intentional HTTP 500 body reaches visitors.
The advanced `TRUST_PROXY=true` setting uses your proxy's `X-Real-IP` for GeoIP
and the footer (or the rightmost `X-Forwarded-For` entry if absent). Enable it
only when visitors cannot bypass your trusted proxy, and configure that proxy
to overwrite `X-Real-IP` with the actual visitor IP. With multiple proxies/CDNs,
configure trusted real-IP handling on your proxy; otherwise you may locate an
intermediate proxy instead. Incoming Cloudflare headers do not determine location.
Hostname detection works either way.

Private/LAN addresses cannot be geolocated. They display "Cloudflare network"
unless the optional `FALLBACK_COLO` is set to a known code, such as `IAD` for
Ashburn or `LHR` for London. This fallback never overrides a successful GeoIP lookup.

The image runs as the unprivileged `node` user, works with a read-only filesystem,
and has a health check against `/_outage/health`. A healthy container deliberately
returns HTTP 500 for ordinary page requests.

Images are rebuilt after tests pass on `main`, on version tags, and weekly to
pick up Node/Alpine base-image updates. `latest` tracks main; version tags such
as `1.2.0` and commit tags such as `sha-abcdef0` are also published. GeoIP data is
pinned and checksum-verified at build time, not downloaded at container startup.

## Run

Requires Node.js 22 or newer. Docker users can skip this setup; the image already
contains the database and its reader.

```sh
git clone https://github.com/theodorecharles/JustBlameCloudflare.git
cd JustBlameCloudflare
npm ci --ignore-scripts
npm run geoip:download
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
visitor IP. The included PM2 setup trusts Nginx's `X-Real-IP` header;
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

## Offline location estimates

The bundled [DB-IP City Lite](https://db-ip.com/db/download/ip-to-city-lite)
database maps the visitor's IPv4 or IPv6 address to approximate latitude and
longitude. A great-circle distance calculation then selects the nearest of 311
bundled Cloudflare locations with known coordinates. No Cloudflare subscription,
API key, live trace request, browser geolocation permission, or outbound runtime
connection is needed. Visitor IPs stay on your server.

This is a geographic estimate, **not** Cloudflare's actual routing or a real
outage check. VPNs and imperfect IP records affect accuracy. Unknown and private
addresses use the fallback described above. The error is always simulated.

The image includes the September 2026 database (about 121 MiB uncompressed).
Allow roughly 256 MiB of RAM for the process. The database release, source URL,
and integrity hashes are recorded in `data/geoip-source.json`; updating that
manifest and rebuilding packages a newer release. DB-IP publishes monthly
updates, but the running container never downloads or modifies the database.
The database is excluded from Git, downloaded during builds, and distributed
inside the image. `data/locations.json` contains the September 7, 2026 coordinate
snapshot from [Cloudflare's location list](https://speed.cloudflare.com/locations).

DB-IP's CC BY 4.0 terms require the small "IP Geolocation by DB-IP" footer link.
Keep it when redistributing or customizing the page.

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

The original project code is MIT-licensed. The GeoIP database, its reader, and
Cloudflare-sourced assets and markup are covered in [THIRD_PARTY.md](THIRD_PARTY.md).
