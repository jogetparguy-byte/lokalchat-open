import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";

/**
 * SSRF guard for outbound fetches to user-configured URLs (server-only).
 *
 * Validates the URL scheme and resolves the hostname via DNS-over-HTTPS,
 * checking both A and AAAA records, rejecting loopback, private (RFC1918),
 * link-local and cloud-metadata addresses. Returns a fetch-ready URL that
 * binds to the verified IP addresses to prevent TOCTOU DNS rebinding.
 */

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true;
  }
  const a = parts[0]!;
  const b = parts[1]!;
  if (a === 10 || a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0 && [0, 2].includes(parts[2]!)) return true;
  if (a === 198 && (b === 18 || b === 19 || b === 51 && parts[2] === 100)) return true;
  if (a === 203 && b === 0 && parts[2] === 113) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  // Fail closed outside global unicast, including mapped IPv4 and transition ranges.
  if (isIP(ip) !== 6) return true;
  const [first, second = "0"] = ip.toLowerCase().split(":");
  const prefix = Number.parseInt(first || "0", 16);
  const subnet = Number.parseInt(second || "0", 16);
  if (prefix < 0x2000 || prefix >= 0x4000) return true;
  if (prefix === 0x2002 || prefix === 0x3fff) return true;
  if (prefix === 0x2001 && (subnet <= 0x1ff || subnet === 0xdb8)) return true;
  return false;
}

function isPrivateIp(ip: string): boolean {
  if (!isIP(ip)) return true;
  if (ip.includes(":")) return isPrivateIpv6(ip);
  return isPrivateIpv4(ip);
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
]);

interface ResolvedHost {
  hostname: string;
  ips: string[];
  port: string;
}

async function resolveHost(hostname: string): Promise<ResolvedHost> {
  const [aRes, aaaaRes] = await Promise.all([
    fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(5000),
    }),
    fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=AAAA`, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(5000),
    }),
  ]);

  const ips: string[] = [];

  for (const res of [aRes, aaaaRes]) {
    if (!res.ok) throw new Error("Semakan DNS gagal");
    const json = (await res.json()) as { Answer?: Array<{ type: number; data: string }> };
    const records = (json.Answer ?? []).filter((a) => a.type === 1 || a.type === 28);
    for (const r of records) {
      const ip = r.data;
      if (isPrivateIp(ip)) throw new Error("Alamat IP dalaman tidak dibenarkan");
      ips.push(ip);
    }
  }

  if (ips.length === 0) throw new Error("Hos tidak dapat diselesaikan atau hanya alamat dalaman");
  return { hostname, ips, port: "" };
}

/**
 * Throws unless `raw` is an http(s) URL whose hostname resolves only to
 * public IP addresses. Returns a URL rewritten to use a verified IP with
 * the original hostname preserved in the Host header (caller must set it).
 * The returned URL's hostname will be one of the verified IPs.
 */
export async function assertPublicHttpUrl(raw: string): Promise<{ url: URL; hostHeader: string }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("URL tidak sah");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("URL mesti bermula dengan http(s)://");
  }

  if (url.username || url.password) throw new Error("Credentials dalam URL tidak dibenarkan");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".internal") || host.endsWith(".local") || host.endsWith(".localhost")) {
    throw new Error("Hos dalaman tidak dibenarkan");
  }

  // Literal IP in the URL
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":")) {
    if (isPrivateIp(host)) throw new Error("Alamat IP dalaman tidak dibenarkan");
    return { url, hostHeader: host };
  }

  const resolved = await resolveHost(host);
  const verifiedIp = resolved.ips[0]!;
  const newUrl = new URL(url.toString());
  newUrl.hostname = isIP(verifiedIp) === 6 ? `[${verifiedIp}]` : verifiedIp;
  newUrl.port = url.port ?? "";

  return { url: newUrl, hostHeader: host };
}


/** Connect to the validated IP while retaining the original TLS identity and Host. */
export async function fetchPublicHttp(raw: string, options: {
  method?: string; headers?: Record<string, string>; body?: string;
  signal?: AbortSignal; maxBytes?: number;
} = {}): Promise<Response> {
  const original = new URL(raw);
  const { url } = await assertPublicHttpUrl(raw);
  const ip = url.hostname.replace(/^\[|\]$/g, "");
  const hostname = original.hostname.replace(/^\[|\]$/g, "");
  const transport = original.protocol === "https:" ? https : http;
  const signal = options.signal || AbortSignal.timeout(30000);
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const req = transport.request(original, {
      method: options.method || "GET",
      headers: { ...options.headers, Host: original.host },
      agent: false,
      signal,
      // Preserve SNI and normal certificate checks; only socket DNS is pinned.
      ...(original.protocol === "https:" && !isIP(hostname) ? { servername: hostname } : {}),
      lookup: (_hostname, lookupOptions, callback) => {
        if (lookupOptions.all) callback(null, [{ address: ip, family: isIP(ip) }]);
        else callback(null, ip, isIP(ip));
      },
    }, incoming => {
      const chunks: Buffer[] = [];
      let size = 0;
      incoming.on("error", reject);
      incoming.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > (options.maxBytes || 1024 * 1024)) {
          incoming.destroy(new Error("Respons terlalu besar"));
          return;
        }
        chunks.push(chunk);
      });
      incoming.on("end", () => {
        const status = incoming.statusCode || 502;
        // Node requests never follow redirects, including credential-bearing POSTs.
        if (status >= 300 && status < 400) { reject(new Error("Redirect tidak dibenarkan")); return; }
        const contentType = incoming.headers["content-type"];
        resolve(new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), {
          status, headers: contentType ? { "content-type": contentType } : {},
        }));
      });
    });
    req.on("error", reject);
    req.end(options.body);
  });
}
