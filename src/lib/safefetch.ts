// Fetching an address a member pasted. Server only.
// Every hop (the first address and each redirect) is checked, the address the name resolves to is
// checked at the moment of connecting (so it can't change between the check and the request), and
// private, loopback, link-local and similar ranges are refused.
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import zlib from 'node:zlib';

export class Refused extends Error {}

function privateV4(a: number, b: number, c: number) {
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0 && c === 0)
    || (a === 198 && (b === 18 || b === 19));
}
/** true for any address that isn't an ordinary public one */
export function privateAddress(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) { const [a, b, c] = ip.split('.').map(Number); return privateV4(a, b, c); }
  if (v === 6) {
    const s = ip.toLowerCase();
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/) ?? s.match(/^64:ff9b::(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return privateAddress(mapped[1]);
    const hex = s.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) { const n = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16); return privateV4((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255); }
    return s === '::' || s === '::1' || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s) || /^2001:db8/.test(s) || /^2002:/.test(s) || /^64:ff9b/.test(s);
  }
  return true;
}

const lookup: net.LookupFunction = (host, opts, cb) => {
  dns.lookup(host, { ...(opts as dns.LookupOptions), all: true }, (err, list) => {
    const all = (list ?? []) as dns.LookupAddress[];
    if (err) return cb(err, '', 4);
    if (!all.length || all.some((a) => privateAddress(a.address))) return cb(new Refused('private address') as NodeJS.ErrnoException, '', 4);
    if ((opts as dns.LookupOptions).all) return (cb as any)(null, all);
    cb(null, all[0].address, all[0].family);
  });
};

export function checkUrl(u: string | URL): URL {
  const url = typeof u === 'string' ? new URL(u) : u;
  if (!/^https?:$/.test(url.protocol)) throw new Refused('protocol');
  if (url.username || url.password) throw new Refused('credentials');
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  if (port !== '80' && port !== '443') throw new Refused('port');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) throw new Refused('host');
  if (net.isIP(host) && privateAddress(host)) throw new Refused('private address');
  return url;
}

type Reply = { status: number; headers: http.IncomingHttpHeaders; body: Buffer; url: string };
function once(url: URL, ms: number, headers: Record<string, string>, maxBytes: number): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(url, { method: 'GET', lookup, timeout: ms, headers: { 'Accept-Encoding': 'gzip, deflate, br', ...headers } }, (res) => {
      const enc = String(res.headers['content-encoding'] ?? '').toLowerCase();
      const out: NodeJS.ReadableStream = enc === 'gzip' ? res.pipe(zlib.createGunzip())
        : enc === 'br' ? res.pipe(zlib.createBrotliDecompress())
        : enc === 'deflate' ? res.pipe(zlib.createInflate()) : res;
      const parts: Buffer[] = []; let size = 0;
      out.on('data', (c: Buffer) => {
        size += c.length; parts.push(c);
        if (size > maxBytes) { req.destroy(); resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(parts).subarray(0, maxBytes), url: url.href }); }
      });
      out.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(parts), url: url.href }));
      out.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

/** GET with redirects followed by hand (at most 3), every hop checked */
export async function safeGet(start: string, ms: number, headers: Record<string, string> = {}, maxBytes = 3_000_000) {
  let url = checkUrl(start);
  const deadline = Date.now() + ms;
  for (let hop = 0; hop <= 3; hop++) {
    const left = deadline - Date.now();
    if (left <= 0) throw new Error('timeout');
    const r = await once(url, left, headers, maxBytes);
    const loc = r.headers.location;
    if (r.status >= 300 && r.status < 400 && loc) {
      url = checkUrl(new URL(String(loc), url));
      continue;
    }
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: () => r.body.toString('utf8'), url: r.url };
  }
  throw new Refused('too many redirects');
}
