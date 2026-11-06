/** Resolve once, validate every answer, and pin the actual socket to an approved IP. */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

type Address = { address: string; family: number };
export function isPublicIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a = 0, b = 0, c = 0] = ip.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || b === 2)) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  // Only global unicast IPv6. Deny transition/mapped, documentation and special ranges.
  if (isIP(ip) !== 6) return false;
  const normalized = new URL(`http://[${ip}]/`).hostname
    .slice(1, -1)
    .toLowerCase();
  const first = Number.parseInt(normalized.split(":")[0]!, 16);
  return (
    first >= 0x2000 &&
    first <= 0x3fff &&
    !(
      first === 0x2001 &&
      (Number.parseInt(normalized.split(":")[1] || "0", 16) < 0x200 ||
        normalized.startsWith("2001:db8:"))
    ) &&
    !normalized.startsWith("2002:") &&
    !normalized.startsWith("3fff:")
  );
}

export async function resolvePublicHttpUrl(
  raw: string,
  resolver: (host: string) => Promise<Address[]> = (host) =>
    lookup(host, { all: true, verbatim: true }),
): Promise<{ url: URL; addresses: Address[] }> {
  const url = new URL(raw);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error("URL mesti http(s) tanpa kelayakan pengguna");
  }
  const host = url.hostname
    .replace(/^\[|\]$/g, "")
    .toLowerCase()
    .replace(/\.$/, "");
  if (
    host === "localhost" ||
    host === "metadata.google.internal" ||
    [".localhost", ".internal", ".local"].some((suffix) =>
      host.endsWith(suffix),
    )
  ) {
    throw new Error("Hos dalaman tidak dibenarkan");
  }
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await Promise.race([
        resolver(host),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error("DNS timeout")),
            5000,
          );
          timer.unref();
        }),
      ]);
  if (
    !addresses.length ||
    addresses.some(
      ({ address, family }) => !isPublicIp(address) || isIP(address) !== family,
    )
  ) {
    throw new Error("Hos mesti merujuk kepada alamat IP awam sahaja");
  }
  return { url, addresses };
}

export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  return (await resolvePublicHttpUrl(raw)).url;
}

/** No redirects or pooled sockets; bounded body and total request deadline. */
export async function publicHttpFetch(
  raw: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    maxResponseBytes?: number;
  } = {},
): Promise<Response> {
  const { url, addresses } = await resolvePublicHttpUrl(raw);
  const approved = addresses[0]!;
  const limit = options.maxResponseBytes ?? 2 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        method: options.method ?? "GET",
        headers: options.headers ?? {},
        agent: false,
        // URL remains the original host for HTTP Host, TLS SNI and certificate verification.
        lookup: (_host, lookupOptions, callback) => {
          if (lookupOptions.all) callback(null, [approved]);
          else callback(null, approved.address, approved.family);
        },
      },
      (response) => {
        const status = response.statusCode ?? 502;
        if (status >= 300 && status < 400) {
          response.destroy();
          request.destroy(new Error("Redirect tidak dibenarkan"));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > limit) request.destroy(new Error("Respons terlalu besar"));
          else chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => {
          const headers = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (value !== undefined)
              headers.set(
                name,
                Array.isArray(value) ? value.join(", ") : value,
              );
          }
          resolve(
            new Response(
              [204, 205, 304].includes(status) ? null : Buffer.concat(chunks),
              { status, headers },
            ),
          );
        });
      },
    );
    const timer = setTimeout(
      () => request.destroy(new Error("Permintaan tamat masa")),
      options.timeoutMs ?? 30000,
    );
    timer.unref();
    request.on("close", () => clearTimeout(timer));
    request.on("error", reject);
    request.end(options.body);
  });
}
