import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { zipSync, strToU8 } from 'fflate';
import { extractDocumentText } from '../src/lib/kb-extract.server.ts';
import { assertPublicHttpUrl, fetchPublicHttp } from '../src/lib/ssrf.server.ts';

test('DOCX extracts text/entities without inflating unrelated members', async () => {
  const archive = zipSync({ 'word/document.xml': strToU8('<w:p>A &amp; B &lt; C &#65; &#x42; &amp;lt;</w:p>'), 'media/image.bin': new Uint8Array(1000000) });
  assert.equal(await extractDocumentText('docx', archive), 'A & B < C A B &lt;');
});
test('DOCX rejects declared and forged-size bombs, duplicates and missing documents', async () => {
  const huge = zipSync({ 'word/document.xml': new Uint8Array(3 * 1024 * 1024).fill(65) });
  await assert.rejects(extractDocumentText('docx', huge), /had saiz/);
  const forged = huge.slice();
  new DataView(forged.buffer).setUint32(22, 1, true);
  await assert.rejects(extractDocumentText('docx', forged), /had saiz/);
  await assert.rejects(extractDocumentText('docx', zipSync({ other: strToU8('missing') })), /tidak sah/);
  const many = Object.fromEntries(Array.from({length: 101}, (_, i) => [`${i}`, strToU8('x')]));
  await assert.rejects(extractDocumentText('docx', zipSync(many)), /terlalu banyak/);
});

function dns(t, answers = [{type: 1, data: '93.184.216.34'}]) {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ Answer: answers })));
}
function transport(t, module, { status = 200, chunks = [Buffer.from('{"ok":true}')] } = {}) {
  let seen;
  t.mock.method(module, 'request', (url, options, callback) => {
    seen = { url, options };
    const req = new EventEmitter();
    req.end = body => {
      seen.body = body;
      queueMicrotask(() => {
        const incoming = new EventEmitter();
        incoming.statusCode = status;
        incoming.headers = {'content-type': 'application/json'};
        incoming.destroy = error => incoming.emit('error', error);
        callback(incoming);
        for (const chunk of chunks) incoming.emit('data', chunk);
        incoming.emit('end');
      });
    };
    return req;
  });
  return () => seen;
}
test('custom HTTPS pins socket DNS but keeps SNI, certificate hostname, port and auth body', async t => {
  dns(t);
  const seen = transport(t, https);
  const result = await fetchPublicHttp('https://api.example.com:8443/v1/chat/completions', {
    method: 'POST', headers: { Authorization: 'Bearer test-only', Host: 'wrong' }, body: '{"model":"test"}',
  });
  assert.deepEqual(await result.json(), {ok: true});
  const {url, options, body} = seen();
  assert.equal(url.hostname, 'api.example.com');
  assert.equal(options.servername, 'api.example.com');
  assert.equal(options.headers.Host, 'api.example.com:8443');
  assert.equal(options.headers.Authorization, 'Bearer test-only');
  assert.equal(options.agent, false);
  assert.notEqual(options.rejectUnauthorized, false);
  assert.equal(body, '{"model":"test"}');
  options.lookup('api.example.com', {}, (error, address, family) => {
    assert.equal(error, null); assert.equal(address, '93.184.216.34'); assert.equal(family, 4);
  });
  options.lookup('api.example.com', {all: true}, (error, addresses) => {
    assert.equal(error, null); assert.deepEqual(addresses, [{address: '93.184.216.34', family: 4}]);
  });
});
test('mixed private/public DNS and URL credentials fail before transport', async t => {
  dns(t, [{type: 1, data:'93.184.216.34'}, {type: 1, data:'127.0.0.1'}]);
  await assert.rejects(assertPublicHttpUrl('https://api.example.com'), /dalaman/);
  await assert.rejects(assertPublicHttpUrl('https://user:pass@api.example.com'), /Credentials/);
  for (const url of ['http://127.0.0.1', 'http://169.254.169.254', 'http://[::1]', 'http://10.0.0.1']) {
    await assert.rejects(assertPublicHttpUrl(url), /dalaman/);
  }
});
test('custom requests reject redirects and bounded response overflow', async t => {
  dns(t);
  const mock = transport(t, http, {status: 302});
  await assert.rejects(fetchPublicHttp('http://api.example.com'), /Redirect/);
  t.mock.restoreAll();
  dns(t);
  transport(t, http, {chunks: [Buffer.alloc(20)]});
  await assert.rejects(fetchPublicHttp('http://api.example.com', {maxBytes: 10}), /terlalu besar/);
});

test('public IPv6 stays usable while mapped and transition destinations are refused', async t => {
  dns(t, [{type: 28, data:'2606:4700:4700::1111'}]);
  const result = await assertPublicHttpUrl('https://api.example.com');
  assert.equal(result.url.hostname, '[2606:4700:4700::1111]');
  for (const ip of ['::ffff:7f00:1', 'fc00::1', 'fe80::1', '2002:7f00:1::', '2001:db8::1']) {
    await assert.rejects(assertPublicHttpUrl(`http://[${ip}]`), /dalaman/);
  }
});
