import http from 'node:http';
import { chmod, lstat, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const MAX_CREATE_BYTES = 8 * 1024 * 1024;

export async function startLoopbackDockerProxy({ upstreamSocket, socketPath, projectId }) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(projectId || '')) throw new Error('Invalid disposable project ID.');
  if (!upstreamSocket || !socketPath || upstreamSocket === socketPath) throw new Error('Distinct Unix socket paths are required.');
  try { await lstat(socketPath); throw new Error('Proxy socket path already exists.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const sockets = new Set();
  let createCount = 0;
  const rejections = [];
  const recordRejection = (name, reason) => {
    rejections.push({ name: /^supabase_[a-zA-Z0-9_-]{1,180}$/.test(name || '') ? name : name ? '[non-project name]' : '[unnamed]', reason });
    if (rejections.length > 100) rejections.shift();
  };
  const reject = (response, status, message) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ message }));
  };
  const server = http.createServer(async (request, response) => {
    let replacement;
    const url = new URL(request.url, 'http://docker.local');
    if (request.method === 'POST' && /^\/(?:v[\d.]+\/)?(?:containers|volumes|networks)\/prune$/.test(url.pathname)) {
      try {
        const filters = JSON.parse(url.searchParams.get('filters') || '{}');
        const values = Array.isArray(filters.label) ? filters.label : filters.label && typeof filters.label === 'object' ? Object.keys(filters.label).filter(key => filters.label[key] === true) : [];
        // Repeated Docker label filters may be ORed by the runtime. Accept one
        // exact ownership selector so a second project cannot widen cleanup.
        if (values.length !== 1 || values[0] !== `com.supabase.cli.project=${projectId}`) throw new Error();
        if (/\/volumes\/prune$/.test(url.pathname)) delete filters.all;
        url.searchParams.set('filters', JSON.stringify(filters));
      } catch { recordRejection(null, 'unscoped-prune'); request.resume(); return reject(response, 403, 'Prune requires the exact disposable project label.'); }
    }
    if (request.method === 'POST' && /^\/(?:v[\d.]+\/)?containers\/create$/.test(url.pathname)) {
      const name = url.searchParams.get('name');
      if (name && (!/^supabase_[a-zA-Z0-9_-]+$/.test(name) || !name.endsWith(`_${projectId}`))) {
        recordRejection(name, 'container-name');
        request.resume(); return reject(response, 403, 'Only this disposable Supabase project may create containers.');
      }
      try {
        const chunks = []; let bytes = 0;
        for await (const chunk of request) {
          bytes += chunk.length;
          if (bytes > MAX_CREATE_BYTES) return reject(response, 413, 'Container request too large.');
          chunks.push(chunk);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
        // Go CLI DockerRunOnce helpers omit names but DockerStart attaches both
        // project labels. Give only these scoped helpers an explicit safe name.
        if (!name) {
          if (body.Labels?.['com.supabase.cli.project'] !== projectId || body.Labels?.['com.docker.compose.project'] !== projectId) {
            recordRejection(name, 'unnamed-unscoped');
            return reject(response, 403, 'Unnamed helpers require both exact disposable project labels.');
          }
          url.searchParams.set('name', `supabase_job_${randomUUID()}_${projectId}`);
        }
        const config = body.HostConfig ??= {};
        if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error();
        if (String(config.NetworkMode).toLowerCase() === 'host' || config.Privileged || config.PublishAllPorts) {
          recordRejection(name, 'unsafe-host-config');
          return reject(response, 403, 'Host networking, privileged containers and automatic port publishing are forbidden.');
        }
        if (config.PortBindings != null) {
          if (typeof config.PortBindings !== 'object' || Array.isArray(config.PortBindings)) throw new Error();
          for (const bindings of Object.values(config.PortBindings)) {
            if (bindings == null) continue;
            if (!Array.isArray(bindings)) throw new Error();
            for (const binding of bindings) {
              if (!binding || typeof binding !== 'object' || Array.isArray(binding)) throw new Error();
              binding.HostIp = '127.0.0.1';
            }
          }
        }
        replacement = Buffer.from(JSON.stringify(body));
        createCount++;
      } catch { return reject(response, 400, 'Invalid container creation request.'); }
    }
    const headers = { ...request.headers };
    if (replacement) { delete headers['transfer-encoding']; headers['content-length'] = String(replacement.length); }
    const upstream = http.request({ socketPath: upstreamSocket, method: request.method, path: `${url.pathname}${url.search}`, headers }, result => {
      response.writeHead(result.statusCode, result.headers);
      result.pipe(response);
    });
    upstream.on('error', () => { if (!response.headersSent) reject(response, 502, 'Disposable container runtime unavailable.'); else response.destroy(); });
    request.on('aborted', () => upstream.destroy());
    response.on('close', () => { if (!response.writableFinished) upstream.destroy(); });
    if (replacement) upstream.end(replacement); else request.pipe(upstream);
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.on('upgrade', (request, client, head) => {
    const upstream = http.request({ socketPath: upstreamSocket, method: request.method, path: request.url, headers: request.headers });
    upstream.on('upgrade', (response, runtime, runtimeHead) => {
      const lines = [`HTTP/${response.httpVersion} ${response.statusCode} ${response.statusMessage}`];
      for (let index = 0; index < response.rawHeaders.length; index += 2) lines.push(`${response.rawHeaders[index]}: ${response.rawHeaders[index + 1]}`);
      client.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (runtimeHead.length) client.write(runtimeHead);
      if (head.length) runtime.write(head);
      runtime.on('error', () => client.destroy());
      client.on('error', () => runtime.destroy());
      client.on('close', () => runtime.destroy());
      runtime.on('close', () => client.destroy());
      client.pipe(runtime).pipe(client);
    });
    upstream.on('response', response => { client.end(`HTTP/1.1 ${response.statusCode} Runtime upgrade refused\r\nConnection: close\r\n\r\n`); response.resume(); });
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
    upstream.end();
  });
  await new Promise((resolve, rejectListen) => { server.once('error', rejectListen); server.listen(socketPath, resolve); });
  await chmod(socketPath, 0o600);
  let closed = false;
  return {
    socketPath,
    get createCount() { return createCount; },
    get rejections() { return rejections.map(entry => ({ ...entry })); },
    async close() {
      if (closed) return;
      closed = true;
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve, rejectClose) => server.close(error => error ? rejectClose(error) : resolve()));
      await unlink(socketPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
    },
  };
}
