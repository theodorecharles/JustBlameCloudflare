# Third-party material

This project is independent of Cloudflare and is not endorsed by Cloudflare.

The markup in `templates/error.html` is adapted from Cloudflare's standard error
page. Its status indicators, error text, dynamic fields, and asset paths were
adjusted for this application, and a DB-IP attribution link was added.
`public/styles/main.css` is Cloudflare's original
error-page stylesheet with only its image URLs changed to local asset paths.
The five images in `public/images/` are the original Cloudflare error-page icons.
These were captured on September 7, 2026, from the Cloudflare-generated response
at https://games-dev.tedcharles.net/ and its `/cdn-cgi/` asset paths.

`public/locations.json` contains data-center codes and city names extracted from
https://www.cloudflarestatus.com/api/v2/components.json on September 7, 2026.
`data/locations.json` combines those city names with coordinates for 311 matching
locations from https://speed.cloudflare.com/locations, retrieved on the same day.

Cloudflare names, marks, and third-party material remain subject to their
respective owners' rights. The project's MIT license does not grant additional
rights to that material.

## DB-IP City Lite

IP Geolocation by [DB-IP](https://db-ip.com). The unmodified September 2026
IP to City Lite database is bundled in Docker images as `data/dbip-city-lite.mmdb`.
It is licensed under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/),
not the project's MIT license. Source and download terms:
https://db-ip.com/db/download/ip-to-city-lite. Release and checksums are recorded
in `data/geoip-source.json`. The database is downloaded at build time and is not
stored in the Git repository. No endorsement by DB-IP is implied.

The page footer includes the link required by DB-IP for web applications using
this data. Preserve that attribution and the database license when redistributing.

## MMDB reader

`mmdb-lib` 3.0.3 (https://github.com/runk/mmdb-lib) is MIT-licensed. Its original
copyright and license notice ship in `node_modules/mmdb-lib/LICENSE` in the image.
