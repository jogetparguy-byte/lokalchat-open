import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { mkdtemp, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { startLoopbackDockerProxy } from './helpers/loopback-docker-proxy.mjs';

test('proxy restricts container names and forces every published port onto loopback', async t => {
  const root = await mkdtemp(join(tmpdir(), 'lokalchat-docker-proxy-'));
  const upstreamSocket = join(root, 'upstream.sock');
  const socketPath = join(root, 'proxy.sock');
  const received = [];
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    received.push({ path: req.url, body: Buffer.concat(chunks).toString() });
    res.writeHead(201); res.end('{}');
  });
  server.on('upgrade', (req, socket, head) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n');
    if (head.length) socket.write(head);
    socket.pipe(socket);
  });
  await new Promise(resolve => server.listen(upstreamSocket, resolve));
  const proxy = await startLoopbackDockerProxy({ upstreamSocket, socketPath, projectId: 'audit123' });
  t.after(async () => { await proxy.close(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  async function request(path, body, method = 'POST') {
    return new Promise((resolve, reject) => {
      const req = http.request({ socketPath, path, method, headers: { 'content-type': 'application/json', connection: 'close' } }, res => {
        res.resume(); res.on('end', () => resolve(res.statusCode));
      }); req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }
  assert.equal((await stat(socketPath)).mode & 0o777, 0o600);
  assert.equal(await request('/v1.47/containers/create?name=supabase_db_audit123', { HostConfig: { PortBindings: { '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '55432' }, { HostIp: '::', HostPort: '55433' }], '9999/tcp': [{ HostPort: '59999' }] } } }), 201);
  const bindings = JSON.parse(received[0].body).HostConfig.PortBindings;
  assert.deepEqual(Object.values(bindings).flat().map(binding => binding.HostIp), ['127.0.0.1', '127.0.0.1', '127.0.0.1']);
  assert.equal(bindings['5432/tcp'][0].HostPort, '55432');
  for (const name of ['supabase_db_other', 'unrelated_audit123', '', 'supabase_audit123evil']) {
    assert.equal(await request(`/containers/create?name=${name}`, {}), 403);
  }
  for (const config of [{ NetworkMode: 'host' }, { Privileged: true }, { PublishAllPorts: true }]) {
    assert.equal(await request('/containers/create?name=supabase_db_audit123', { HostConfig: config }), 403);
  }
  assert.equal(received.length, 1, 'blocked requests never reach runtime');
  assert.equal(proxy.createCount, 1, 'only accepted creation requests increment runtime proof counter');
  const labels = { 'com.supabase.cli.project': 'audit123', 'com.docker.compose.project': 'audit123' };
  assert.equal(await request('/v1.47/containers/create', { Labels: labels }), 201);
  assert.match(new URL(received.at(-1).path, 'http://docker').searchParams.get('name'), /^supabase_job_[a-f0-9-]+_audit123$/);
  assert.equal(await request('/containers/create', { Labels: { ...labels, 'com.docker.compose.project': 'other' } }), 403);
  const scopedPrune = { label: ['com.supabase.cli.project=audit123'], all: ['true'] };
  assert.equal(await request(`/v1.47/volumes/prune?filters=${encodeURIComponent(JSON.stringify(scopedPrune))}`), 201);
  const forwardedFilters = JSON.parse(new URL(received.at(-1).path, 'http://docker').searchParams.get('filters'));
  assert.deepEqual(forwardedFilters, { label: ['com.supabase.cli.project=audit123'] });
  for (const filters of [{ all: ['true'] }, { label: ['com.supabase.cli.project=other'], all: ['true'] }, { label: ['com.supabase.cli.project=audit123', 'com.supabase.cli.project=other'] }]) {
    assert.equal(await request(`/volumes/prune?filters=${encodeURIComponent(JSON.stringify(filters))}`), 403);
  }
  assert.equal(await request('/containers/prune'), 403);
  // Listing stopped containers needs the query parameter; only the unsupported
  // Docker volume-prune filter named "all" may be removed for Podman.
  const containerFilters = { label: ['com.supabase.cli.project=audit123'] };
  assert.equal(await request(`/v1.47/containers/json?all=true&filters=${encodeURIComponent(JSON.stringify(containerFilters))}`, undefined, 'GET'), 201);
  const listUrl = new URL(received.at(-1).path, 'http://docker');
  assert.equal(listUrl.searchParams.get('all'), 'true');
  assert.deepEqual(JSON.parse(listUrl.searchParams.get('filters')), containerFilters);
  const objectFilters = { label: { 'com.supabase.cli.project=audit123': true }, all: { true: true } };
  assert.equal(await request(`/volumes/prune?filters=${encodeURIComponent(JSON.stringify(objectFilters))}`), 201);
  assert.deepEqual(JSON.parse(new URL(received.at(-1).path, 'http://docker').searchParams.get('filters')), { label: objectFilters.label });
  assert.equal(await request(`/volumes/prune?filters=${encodeURIComponent(JSON.stringify({ label: { 'com.supabase.cli.project=audit123': false } }))}`), 403);
  assert.ok(proxy.rejections.some(entry => entry.reason === 'unnamed-unscoped'));
  assert.ok(proxy.rejections.some(entry => entry.reason === 'unscoped-prune'));
  assert.equal(await request('/_ping', undefined, 'GET'), 201);
  await new Promise((resolve, reject) => {
    const socket = net.connect(socketPath); let buffer = '';
    socket.on('error', reject);
    socket.on('connect', () => socket.write('POST /v1.47/exec/test/start HTTP/1.1\r\nHost: docker\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\nhello'));
    socket.on('data', data => { buffer += data; if (buffer.includes('\r\n\r\nhello')) { socket.destroy(); resolve(); } });
    socket.setTimeout(3000, () => { socket.destroy(); reject(new Error('Upgrade tunnel timed out')); });
  });
});

test('proxy preserves runtime status, headers and streamed log bytes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'lokalchat-docker-stream-'));
  const upstreamSocket = join(root, 'upstream.sock');
  const socketPath = join(root, 'proxy.sock');
  const payload = Buffer.from([1, 0, 0, 0, 0, 0, 0, 4, 111, 107, 13, 10]);
  const server = http.createServer((req, res) => {
    assert.equal(req.method, 'GET');
    assert.equal(req.url, '/v1.47/containers/helper/logs?stdout=1&stderr=1&follow=1');
    res.writeHead(200, { 'content-type': 'application/vnd.docker.raw-stream', 'x-runtime-test': 'preserved' });
    res.write(payload.subarray(0, 5));
    setImmediate(() => res.end(payload.subarray(5)));
  });
  await new Promise(resolve => server.listen(upstreamSocket, resolve));
  const proxy = await startLoopbackDockerProxy({ upstreamSocket, socketPath, projectId: 'audit123' });
  t.after(async () => { await proxy.close(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => {
    const req = http.get({ socketPath, path: '/v1.47/containers/helper/logs?stdout=1&stderr=1&follow=1' }, res => {
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['content-type'], 'application/vnd.docker.raw-stream');
      assert.equal(res.headers['x-runtime-test'], 'preserved');
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => { assert.deepEqual(Buffer.concat(chunks), payload); resolve(); });
    });
    req.on('error', reject);
  });
});
