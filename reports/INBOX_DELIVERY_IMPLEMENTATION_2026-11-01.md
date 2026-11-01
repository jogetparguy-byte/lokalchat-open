# Integrasi penghantaran inbox — 1 November 2026

Salinan kerja: `/home/irsyad_b/Projects/lokalchat-open` daripada USB `lokalchat-app`. USB dan backend berasingan tidak diubah. Fail .env/credential tidak disalin. Tiada DB, migration atau deployment dijalankan.

## Perubahan

- Label Cuba Semula dan mesej bantuan BM.
- Status pending/sending/sent/failed dikekalkan; sent hanya penerimaan Meta.
- Retry menggunakan fungsi sedia ada, lock klik berganda, semakan tenant dan claim atomik. Frontend turut mengesahkan mesej milik chat terpilih dan human+failed sebelum memanggil retry.
- Server hanya memulangkan mesej ralat dalam allowlist tetap; ralat lama ditapis ketika dibaca. Respons gagal provider tidak dibaca/dilog. UI tidak memaparkan teks ralat arbitrary.
- Ujian route menggunakan DashboardPage sebenar, React Query dan UI; server boundary/router search/shell dimock. Meliputi ID tepat, klik berganda, retry gagal, refresh, pertukaran chat dan bubble sama.
- Ujian backend ditambah untuk status/sender tidak layak, tenant, idempotency dan penapisan ralat.

## Keputusan pengesahan sesi ini

- LULUS: 23 assertion/pemeriksaan native Node, termasuk safeDeliveryError terhadap contoh token/API key/credential, allowlist tepat dan sintaks 3 fail TypeScript server/helper melalui stripTypeScriptTypes.
- LULUS: node --check untuk tests/backend-delivery.test.mjs, tests/delivery-error.test.mjs, tests/inbox-route.test.mjs, tests/browser.test.mjs dan tests/staging-browser.mjs.
- TERHALANG: pnpm test, pnpm typecheck, pnpm build dan test:harness. Dependencies tiada; pemasangan offline cache tidak lengkap dan pemasangan online gagal resolve registry.npmjs.org. pnpm 12 cuba pemasangan automatik sebelum script; percubaan dihentikan selepas kegagalan DNS berulang. Skrip belum mencapai execution penuh.
- Percubaan langsung dua suite backend/security dengan TypeScript cache lain gagal sebelum ujian kerana cache compiler tidak lengkap (ModuleKind tidak tersedia). Symlink sementara dibuang; dependency/lockfile tidak ditukar.
- Ujian route/browser BELUM DILAKSANAKAN; tiada bukti E2E atau RLS live daripada sesi ini. Typecheck/build juga belum disahkan.

## Jalankan selepas dependencies tersedia

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
# Terminal berasingan, konfigurasi lokal tanpa credential production:
pnpm test:harness
pnpm test:inbox-route
# Suite browser lama juga memerlukan server app lokal tanpa konfigurasi Supabase:
pnpm start
pnpm test:browser
```

Jangan jalankan test:staging:* secara automatik: ia menulis data. Tiada migration baharu diperlukan. Ketidakpastian penghantaran selepas provider menerima tetapi sebelum DB finalize ialah batas sedia ada; jangan tambah resend automatik bagi sending.

## Semua fail diubah/ditambah

- `package.json`
- `src/components/dashboard/ChatWindow.tsx`
- `src/lib/delivery-error.ts`
- `src/lib/lokalchat.functions.ts`
- `src/lib/whatsapp.server.ts`
- `src/routes/_authenticated/dashboard_.inbox.tsx`
- `tests/backend-delivery.test.mjs`
- `tests/browser-harness/route-api.ts`
- `tests/browser-harness/route-main.tsx`
- `tests/browser-harness/route-router.ts`
- `tests/browser-harness/route-shell.tsx`
- `tests/browser-harness/route.html`
- `tests/browser-harness/vite.config.mjs`
- `tests/browser.test.mjs`
- `tests/delivery-error.test.mjs`
- `tests/inbox-route.test.mjs`
- `tests/inbox.test.tsx`
- `tests/staging-browser.mjs`
