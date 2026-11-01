/**
 * SSRF guard for outbound fetches to user-configured URLs (server-only).
 *
 * Validates the URL scheme and resolves the hostname via DNS-over-HTTPS,
 * rejecting loopback, private (RFC1918), link-local and cloud-metadata
 * addresses before any fetch is attempted.
 */

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true; // malformed → treat as unsafe
  }
  const a = parts[0]!;
  const b = parts[1]!;
  if (a === 10 || a === 127) return true; // private / loopback
  if (a === 0) return true; // "this" network
  if (a === 169 && b === 254) return true; // link-local (incl. 169.254.169.254 metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isPrivateIp(ip: string): boolean {
  if (ip.includes(":")) {
    const norm = ip.toLowerCase();
    if (norm === "::1" || norm === "::") return true;
    if (norm.startsWith("fc") || norm.startsWith("fd")) return true; // ULA
    if (norm.startsWith("fe8") || norm.startsWith("fe9") || norm.startsWith("fea") || norm.startsWith("feb"))
      return true; // link-local
    // IPv4-mapped
    const mapped = norm.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped?.[1]) return isPrivateIpv4(mapped[1]);
    return true; // unknown IPv6 → deny
  }
  return isPrivateIpv4(ip);
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
]);

async function resolveHostIps(hostname: string): Promise<string[]> {
  const res = await fetch(
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
    {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!res.ok) return [];
  const json = (await res.json()) as { Answer?: Array<{ type: number; data: string }> };
  return (json.Answer ?? []).filter((a) => a.type === 1).map((a) => a.data);
}

/**
 * Throws unless `raw` is an http(s) URL whose hostname resolves only to
 * public IP addresses. Returns the parsed URL when safe.
 */
export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("URL tidak sah");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("URL mesti bermula dengan http(s)://");
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".internal") || host.endsWith(".local") || host.endsWith(".localhost")) {
    throw new Error("Hos dalaman tidak dibenarkan");
  }

  // Literal IP in the URL
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":")) {
    if (isPrivateIp(host)) throw new Error("Alamat IP dalaman tidak dibenarkan");
    return url;
  }

  const ips = await resolveHostIps(host);
  if (ips.length === 0) throw new Error("Hos tidak dapat diselesaikan");
  for (const ip of ips) {
    if (isPrivateIp(ip)) throw new Error("Hos dalaman tidak dibenarkan");
  }
  return url;
}

