# Third-party material

This project is independent of Cloudflare and is not endorsed by Cloudflare.

The markup in `templates/error.html` is adapted from Cloudflare's standard error
page. Its status indicators, error text, dynamic fields, and asset paths were
adjusted for this application. `public/styles/main.css` is Cloudflare's original
error-page stylesheet with only its image URLs changed to local asset paths.
The five images in `public/images/` are the original Cloudflare error-page icons.
These were captured on September 7, 2026, from the Cloudflare-generated response
at https://games-dev.tedcharles.net/ and its `/cdn-cgi/` asset paths.

`public/locations.json` contains data-center codes and city names extracted from
https://www.cloudflarestatus.com/api/v2/components.json on September 7, 2026.

Cloudflare names, marks, and third-party material remain subject to their
respective owners' rights. The project's MIT license does not grant additional
rights to that material.
