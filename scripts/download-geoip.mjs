import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { Reader } from 'mmdb-lib';

const source = JSON.parse(readFileSync(new URL('../data/geoip-source.json', import.meta.url), 'utf8'));
console.log(`Downloading ${source.provider} ${source.release} (build-time only)…`);
const response = await fetch(source.url, { signal: AbortSignal.timeout(120_000) });
if (!response.ok) throw new Error(`GeoIP download failed: HTTP ${response.status}`);
const archive = Buffer.from(await response.arrayBuffer());
const digest = (algorithm, data) => createHash(algorithm).update(data).digest('hex');
if (digest('sha256', archive) !== source.archiveSha256) throw new Error('GeoIP archive SHA-256 mismatch');
const database = gunzipSync(archive, { maxOutputLength: 256 * 1024 * 1024 });
if (digest('sha1', database) !== source.databaseSha1) throw new Error('GeoIP database checksum does not match the provider');
const reader = new Reader(database);
if (!reader.get('8.8.8.8')?.location || !reader.get('2001:4860:4860::8888')?.location) {
  throw new Error('GeoIP database must support city coordinates for both IPv4 and IPv6');
}
writeFileSync(new URL('../data/dbip-city-lite.mmdb', import.meta.url), database);
console.log(`Bundled ${database.length} bytes; verified archive and database checksums.`);
