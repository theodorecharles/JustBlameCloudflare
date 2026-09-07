import { readFileSync } from 'node:fs';
import { BlockList, isIP } from 'node:net';
import { Reader } from 'mmdb-lib';

const locations = JSON.parse(readFileSync(new URL('./data/locations.json', import.meta.url), 'utf8'));
const reserved = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 3],
]) reserved.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [
  ['::', 96], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
]) reserved.addSubnet(network, prefix, 'ipv6');

export function normalizeIP(value) {
  if (typeof value !== 'string') return '';
  const address = value.trim().replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1');
  return isIP(address) ? address : '';
}

export function clientIPFor(request, trustProxy = false) {
  if (trustProxy) {
    // X-Real-IP must be overwritten by the proxy. With an appended XFF chain,
    // trust only the rightmost entry, never an arbitrary client-supplied first IP.
    const real = normalizeIP(request.headers['x-real-ip']);
    const chain = request.headers['x-forwarded-for'];
    const forwarded = typeof chain === 'string' ? normalizeIP(chain.split(',').at(-1)) : '';
    if (real || forwarded) return real || forwarded;
  }
  return normalizeIP(request.socket.remoteAddress);
}

const radians = degrees => degrees * Math.PI / 180;
export function nearestLocation(latitude, longitude, candidates = locations) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
    || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  let nearest = null;
  let minimum = Infinity;
  for (const location of candidates) {
    // Haversine's angular distance works across the date line and near the poles.
    const score = Math.sin(radians(location.latitude - latitude) / 2) ** 2
      + Math.cos(radians(latitude)) * Math.cos(radians(location.latitude))
      * Math.sin(radians(location.longitude - longitude) / 2) ** 2;
    if (score < minimum) { minimum = score; nearest = location; }
  }
  return nearest;
}

export function createGeoLocator(reader) {
  return address => {
    const ip = normalizeIP(address);
    const version = isIP(ip);
    if (!version || reserved.check(ip, version === 4 ? 'ipv4' : 'ipv6')) return null;
    const point = reader.get(ip)?.location;
    return nearestLocation(point?.latitude, point?.longitude);
  };
}

let locate;
export function loadGeoLocator() {
  if (!locate) {
    let database;
    try {
      database = readFileSync(new URL('./data/dbip-city-lite.mmdb', import.meta.url));
    } catch (error) {
      throw new Error('Bundled GeoIP database missing or unreadable. Run npm run geoip:download before starting.', { cause: error });
    }
    locate = createGeoLocator(new Reader(database));
  }
  return locate;
}
