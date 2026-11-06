import assert from "node:assert/strict";
import { test, mock } from "node:test";
import dns from "node:dns/promises";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { EventEmitter } from "node:events";
import { zipSync, strToU8 } from "fflate";
import {
  isPublicIp,
  resolvePublicHttpUrl,
  publicHttpFetch,
} from "../src/lib/ssrf.server.ts";
import {
  extractDocumentText,
  chunkText,
  MAX_DOCUMENT_TEXT,
} from "../src/lib/kb-extract.server.ts";
import { readDocxText } from "../src/lib/docx-worker.server.ts";

const zip = (xml) => zipSync({ "word/document.xml": strToU8(xml) });
test("SSRF denies private, metadata, mapped and reserved IPs", () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.1.1",
    "169.254.169.254",
    "172.16.1.1",
    "192.168.1.1",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:7f00:1",
    "2002:7f00:1::",
    "2001:db8::1",
    "bad",
  ])
    assert.equal(isPublicIp(ip), false, ip);
  for (const ip of [
    "1.1.1.1",
    "8.8.8.8",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
  ])
    assert.equal(isPublicIp(ip), true, ip);
});
test("SSRF validates all A/AAAA answers and normalized URLs", async () => {
  for (const raw of [
    "http://127.1",
    "http://0x7f000001",
    "http://[::ffff:127.0.0.1]",
    "http://localhost.",
    "file:///tmp/x",
    "http://user:pass@example.com",
  ])
    await assert.rejects(resolvePublicHttpUrl(raw));
  await assert.rejects(
    resolvePublicHttpUrl("https://example.com", async () => [
      { address: "1.1.1.1", family: 4 },
      { address: "::1", family: 6 },
    ]),
  );
  await assert.rejects(
    resolvePublicHttpUrl("https://example.com", async () => []),
  );
  const result = await resolvePublicHttpUrl("https://example.com", async () => [
    { address: "2606:4700:4700::1111", family: 6 },
  ]);
  assert.equal(result.addresses[0].family, 6);
});
test("socket is pinned despite DNS change; TLS hostname stays intact; redirect/body/deadline enforced", async () => {
  let resolutions = 0;
  const dnsMock = mock.method(dns, "lookup", async () => {
    resolutions++;
    return [
      { address: resolutions === 1 ? "1.1.1.1" : "127.0.0.1", family: 4 },
    ];
  });
  let mode = "ok";
  const requestMock = mock.method(
    https,
    "request",
    (url, options, onResponse) => {
      assert.equal(url.hostname, "example.com");
      assert.equal(options.agent, false);
      options.lookup(url.hostname, {}, (error, address, family) => {
        assert.equal(error, null);
        assert.equal(address, "1.1.1.1");
        assert.equal(family, 4);
      });
      options.lookup(url.hostname, { all: true }, (error, addresses) => {
        assert.equal(error, null);
        assert.deepEqual(addresses, [{ address: "1.1.1.1", family: 4 }]);
      });
      const req = new EventEmitter();
      req.destroy = (error) => {
        req.emit("error", error);
        req.emit("close");
      };
      req.end = () =>
        queueMicrotask(() => {
          if (mode === "timeout") return;
          const response = new EventEmitter();
          response.statusCode = mode === "redirect" ? 302 : 200;
          response.headers = { "content-type": "application/json" };
          response.destroy = () => {};
          onResponse(response);
          if (mode !== "redirect") {
            response.emit("data", Buffer.from('{"ok":true}'));
            response.emit("end");
            req.emit("close");
          }
        });
      return req;
    },
  );
  syncBuiltinESMExports();
  try {
    assert.deepEqual(
      await (await publicHttpFetch("https://example.com/test")).json(),
      { ok: true },
    );
    assert.equal(resolutions, 1);
    resolutions = 0;
    mode = "redirect";
    await assert.rejects(publicHttpFetch("https://example.com"), /Redirect/);
    resolutions = 0;
    mode = "large";
    await assert.rejects(
      publicHttpFetch("https://example.com", { maxResponseBytes: 2 }),
      /besar/,
    );
    resolutions = 0;
    mode = "timeout";
    const keepAlive = setTimeout(() => {}, 100);
    await assert.rejects(
      publicHttpFetch("https://example.com", { timeoutMs: 10 }),
      /masa/,
    );
    clearTimeout(keepAlive);
  } finally {
    dnsMock.mock.restore();
    requestMock.mock.restore();
    syncBuiltinESMExports();
  }
});
test("normal DOCX, text and chunks still work", async () => {
  assert.equal(
    await extractDocumentText(
      "docx",
      zip("<w:document><w:p>Hello &amp; world</w:p></w:document>"),
    ),
    "Hello & world",
  );
  assert.equal(
    await extractDocumentText(
      "docx",
      zipSync(
        { "word/document.xml": strToU8("<w:p>Stored document</w:p>") },
        { level: 0 },
      ),
    ),
    "Stored document",
  );
  assert.equal(
    await extractDocumentText("txt", strToU8("hello\r\nworld")),
    "hello\n\nworld",
  );
  assert.equal(chunkText("hello")[0], "hello");
  assert.ok(chunkText("x".repeat(MAX_DOCUMENT_TEXT)).length <= 200);
});
test("DOCX rejects bombs, dishonest ZIP lengths, malformed and missing document XML", async () => {
  await assert.rejects(
    extractDocumentText("docx", zip("x".repeat(2 * 1024 * 1024 + 1))),
  );
  const dishonest = zip("x".repeat(2 * 1024 * 1024 + 1));
  for (let i = 0; i < dishonest.length - 46; i++) {
    if (new DataView(dishonest.buffer).getUint32(i, true) === 0x02014b50)
      new DataView(dishonest.buffer).setUint32(i + 24, 1, true);
  }
  await assert.rejects(extractDocumentText("docx", dishonest));
  await assert.rejects(extractDocumentText("docx", new Uint8Array([1, 2, 3])));
  await assert.rejects(
    extractDocumentText("docx", zipSync({ "other.xml": strToU8("hello") })),
  );
  await assert.rejects(readDocxText(zip("hello"), 0), /masa/);
});
test("document input/text and chunk parameters are bounded", async () => {
  await assert.rejects(
    extractDocumentText("txt", new Uint8Array(10 * 1024 * 1024 + 1)),
  );
  await assert.rejects(
    extractDocumentText("txt", strToU8("x".repeat(MAX_DOCUMENT_TEXT + 1))),
  );
  await assert.rejects(
    extractDocumentText("docx", zip("x".repeat(MAX_DOCUMENT_TEXT + 1))),
  );
  for (const args of [
    [0, 0],
    [100, 100],
    [100, -1],
    [NaN, 0],
  ])
    assert.throws(() => chunkText("hello", ...args));
});
