#!/usr/bin/env bash
set -euo pipefail

# Install only this application's prepared virtual hosts. No DNS or PM2 changes.
if [[ $EUID -ne 0 ]]; then
    echo "Run this script with sudo." >&2
    exit 1
fi

APP_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
BUNDLE=${1:-"$APP_DIR/.deployment"}
AVAILABLE=/etc/nginx/sites-available/just-blame-cloudflare.conf
ENABLED=/etc/nginx/sites-enabled/just-blame-cloudflare.conf
RELEASE_ROOT=/etc/nginx/just-blame-cloudflare

for tool in openssl curl install nginx systemctl; do
    command -v "$tool" >/dev/null || { echo "Missing command: $tool" >&2; exit 1; }
done
for name in nginx.conf domains.tsv; do
    [[ -f "$BUNDLE/$name" ]] || { echo "Missing deployment file: $BUNDLE/$name" >&2; exit 1; }
done
[[ -d "$BUNDLE/certificates" ]] || { echo "No certificates staged." >&2; exit 1; }
grep -q '^# Managed by JustBlameCloudflare$' "$BUNDLE/nginx.conf"
for path in "$AVAILABLE" "$ENABLED"; do
    if [[ -e "$path" || -L "$path" ]]; then
        [[ -f "$path" ]] && grep -q '^# Managed by JustBlameCloudflare$' "$path" || {
            echo "Refusing to replace an unrelated file: $path" >&2; exit 1;
        }
    fi
done

echo 'Checking the app, certificates, and existing Nginx configuration...'
curl --fail --silent --show-error http://127.0.0.1:8080/_outage/health
nginx -t
while IFS=$'\t' read -r domain certificate; do
    [[ "$domain" =~ ^[a-z0-9][a-z0-9.-]+$ && "$certificate" =~ ^[a-zA-Z0-9-]+$ ]] || {
        echo "Invalid domain or certificate name in domains.tsv" >&2; exit 1;
    }
    cert="$BUNDLE/certificates/$certificate/fullchain.pem"
    key="$BUNDLE/certificates/$certificate/privkey.pem"
    openssl x509 -in "$cert" -noout -checkend 86400 >/dev/null
    openssl x509 -in "$cert" -noout -checkhost "$domain" >/dev/null
    cert_pub=$(openssl x509 -in "$cert" -pubkey -noout | openssl pkey -pubin -outform DER | openssl sha256)
    key_pub=$(openssl pkey -in "$key" -pubout -outform DER | openssl sha256)
    [[ "$cert_pub" == "$key_pub" ]] || { echo "Certificate/key mismatch: $domain" >&2; exit 1; }
done < "$BUNDLE/domains.tsv"

install -d -m 700 "$RELEASE_ROOT"
RELEASE=$(mktemp -d "$RELEASE_ROOT/release.XXXXXXXX")
install -d -m 700 "$RELEASE/certificates"
while IFS=$'\t' read -r domain certificate; do
    install -d -m 700 "$RELEASE/certificates/$certificate"
    install -m 644 "$BUNDLE/certificates/$certificate/fullchain.pem" "$RELEASE/certificates/$certificate/fullchain.pem"
    install -m 600 "$BUNDLE/certificates/$certificate/privkey.pem" "$RELEASE/certificates/$certificate/privkey.pem"
done < "$BUNDLE/domains.tsv"
sed "s|__CERT_ROOT__|$RELEASE/certificates|g" "$BUNDLE/nginx.conf" > "$RELEASE/nginx.conf"
chmod 644 "$RELEASE/nginx.conf"

HAD_AVAILABLE=false
HAD_ENABLED=false
if [[ -e "$AVAILABLE" || -L "$AVAILABLE" ]]; then
    cp -a "$AVAILABLE" "$RELEASE/previous-available"
    HAD_AVAILABLE=true
fi
if [[ -e "$ENABLED" || -L "$ENABLED" ]]; then
    cp -a "$ENABLED" "$RELEASE/previous-enabled"
    HAD_ENABLED=true
fi
rollback() {
    trap - ERR
    echo 'Activation failed. Restoring the previous Nginx site configuration.' >&2
    if [[ -e "$AVAILABLE" || -L "$AVAILABLE" ]]; then mv "$AVAILABLE" "$RELEASE/failed-available"; fi
    if [[ -e "$ENABLED" || -L "$ENABLED" ]]; then mv "$ENABLED" "$RELEASE/failed-enabled"; fi
    if $HAD_AVAILABLE; then cp -a "$RELEASE/previous-available" "$AVAILABLE"; fi
    if $HAD_ENABLED; then cp -a "$RELEASE/previous-enabled" "$ENABLED"; fi
    nginx -t && systemctl reload nginx || true
    echo "Diagnostic files retained at $RELEASE" >&2
    exit 1
}
trap rollback ERR

ln -sfn "$RELEASE/nginx.conf" "$AVAILABLE"
ln -sfn "$AVAILABLE" "$ENABLED"
nginx -t
systemctl reload nginx
trap - ERR

echo 'Nginx reloaded. Checking HTTPS for each configured hostname (HTTP 500 is expected)...'
failures=0
while IFS=$'\t' read -r domain certificate; do
    if status=$(curl --silent --show-error --max-time 10 --resolve "$domain:443:127.0.0.1" \
        -o /dev/null -w '%{http_code}' "https://$domain/") && [[ "$status" == 500 ]]; then
        echo "OK $domain: valid TLS, HTTP 500"
    else
        echo "CHECK $domain: unexpected HTTPS result ${status:-unavailable}" >&2
        failures=$((failures + 1))
    fi
done < "$BUNDLE/domains.tsv"
echo "Installed configuration: $AVAILABLE"
echo "Existing Nginx sites and PM2 apps were not modified."
if [[ $failures -gt 0 ]]; then exit 1; fi
