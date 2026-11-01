import test from 'node:test';
import assert from 'node:assert/strict';
import { documentExtension, uploadDocument } from '../src/lib/upload-document.ts';

const file = new File(['store hours'], 'faq kedai.txt', { type: 'text/plain' });
function harness(options = {}) {
  const calls = [];
  return {
    calls,
    options: {
      file, userId: 'tenant-a', nonce: 'random-id',
      storage: {
        async upload(path, bytes, config) { calls.push(['upload', path, bytes, config]); return { error: options.uploadError ? { message: 'upload failed' } : null }; },
        async remove(paths) { calls.push(['remove', paths]); return { error: options.cleanupError ? { message: 'cleanup failed' } : null }; },
      },
      async record({ data }) { calls.push(['record', data]); if (options.recordError) throw new Error('record failed'); return { id: 'document-1' }; },
    },
  };
}
test('validates supported type, non-empty and size before upload', async () => {
  assert.equal(documentExtension({ name: 'FAQ.CSV', size: 1 }), 'csv');
  assert.throws(() => documentExtension({ name: 'legacy.doc', size: 1 }), /Hanya/);
  assert.throws(() => documentExtension({ name: 'blank.txt', size: 0 }), /10MB/);
  assert.throws(() => documentExtension({ name: 'big.pdf', size: 10 * 1024 * 1024 + 1 }), /10MB/);
  const h = harness();
  await assert.rejects(uploadDocument({ ...h.options, userId: '../other' }), /tidak sah/);
  assert.equal(h.calls.length, 0);
});
test('uploads actual file with correct tenant path before metadata', async () => {
  const h = harness();
  assert.equal(await uploadDocument(h.options), 'document-1');
  assert.deepEqual(h.calls.map(([name]) => name), ['upload', 'record']);
  assert.equal(h.calls[0][1], 'tenant-a/random-id-faq_kedai.txt');
  assert.equal(h.calls[0][2], file);
  assert.deepEqual(h.calls[0][3], { contentType: 'text/plain', upsert: false });
  assert.equal(h.calls[1][1].storagePath, h.calls[0][1]);
  assert.equal(h.calls[1][1].fileSize, file.size);
});
test('does not record metadata after failed upload', async () => {
  const h = harness({ uploadError: true });
  await assert.rejects(uploadDocument(h.options), /upload failed/);
  assert.deepEqual(h.calls.map(([name]) => name), ['upload']);
});
test('removes unrecorded storage object when metadata write fails', async () => {
  const h = harness({ recordError: true });
  await assert.rejects(uploadDocument(h.options), /^Error: record failed$/);
  assert.deepEqual(h.calls.map(([name]) => name), ['upload', 'record', 'remove']);
  assert.deepEqual(h.calls[2][1], [h.calls[0][1]]);
});
test('reports orphan path when cleanup fails', async () => {
  const h = harness({ recordError: true, cleanupError: true });
  await assert.rejects(uploadDocument(h.options), /record failed.*tenant-a\/random-id-faq_kedai.txt/);
});
