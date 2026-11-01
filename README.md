# LokalChat — aplikasi bersepadu

Salinan kerja yang menyatukan UI React daripada `lokalchat-frontend.zip` dengan backend canonical USB. Fail USB asal tidak diubah. Semua operasi aplikasi menggunakan server functions sebenar; adapter data demo dan demo login tidak disertakan.

## Jalankan secara lokal

Gunakan Node.js 24 (versi ujian: 24.22.1) dan pnpm. Lockfile disertakan.

```bash
pnpm install --frozen-lockfile
cp .env.example .env
# Isi konfigurasi projek staging dalam .env.
pnpm dev
```

Buka `http://127.0.0.1:3000`. Script dev memuatkan `.env` untuk pemboleh ubah server; Vite memuatkan `VITE_*` untuk browser. Tanpa konfigurasi, halaman login menyatakan sambungan belum tersedia dan menyekat penghantaran borang.

Untuk production build lokal:

```bash
pnpm build
pnpm typecheck
pnpm start
```

`pnpm start` memuatkan `.env` jika wujud. Port lalai ialah 3000; tetapkan `PORT` dan `HOST` mengikut keperluan. Output ialah server Node Nitro dalam `.output/`, bukan laman statik yang boleh diterbitkan tanpa server.

## Konfigurasi dan migration

- `VITE_SUPABASE_URL` dan `VITE_SUPABASE_PUBLISHABLE_KEY` ialah konfigurasi awam browser. Nilainya mesti sepadan dengan projek server.
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` dan `SUPABASE_SERVICE_ROLE_KEY` diperlukan pada server.
- `WHATSAPP_CRYPTO_KEY` mesti mengekalkan nilai yang sama apabila membaca credentials sedia ada. Jangan tukar nilainya tanpa migrasi/re-encryption yang sesuai.
- Tetapkan penyedia AI mengikut `.env.example`. Jangan gunakan awalan `VITE_` untuk server secrets.
- `.env` sebenar daripada USB tidak disalin. Gunakan konfigurasi staging sebelum menguji operasi yang menulis data.

Gunakan sejarah migration Supabase mengikut versi menaik dan semak sejarah projek dahulu. Jangan jalankan semula migration lama pada projek yang telah menerapkannya. Migration tambahan integrasi ini ialah:

1. `20261024090600_create_kb_storage_bucket.sql`: bucket private `kb-documents`, had 10MiB, jenis MIME dokumen. Polisi objek tenant sedia ada dikekalkan. Migration ini menetapkan bucket sedia ada sebagai private jika ia telah wujud.
2. `20261024090700_human_reply_request_id.sql`: kolum `messages.client_request_id` dan indeks unik untuk permintaan balasan manusia bagi chat yang sama.

3. `20261024090800_complete_dashboard_schema.sql`: memasukkan schema dashboard yang sebelum ini hanya berada dalam Drizzle (owner/report fields, private internal settings dan soalan belum dijawab). Tiada cron job diaktifkan.
4. `20261024090900_vector_extension_search_path.sql`: membenarkan fungsi carian vector menggunakan schema `extensions`. Dua migration baseline turut dibetulkan untuk pemasangan baharu dengan pgvector di schema tersebut.

**Terapkan migration baharu sebelum menjalankan kod baharu pada projek lain.** Staging yang dibenarkan pengguna telah menerima semua 25 migration dan lulus ujian pada 24 Oktober 2026. Kod turut memerlukan migration delivery `20261024090400` dan `20261024090500` daripada backend asal.

Konfigurasikan Supabase Auth Site URL/allowed redirect URL kepada origin aplikasi dan `/dashboard` untuk pengesahan emel. Pendaftaran boleh memerlukan pengesahan emel bergantung tetapan Auth. Peranan admin mesti datang daripada DB; halaman frontend tidak memberikan peranan kepada pengguna.

## Aliran yang disambungkan

- Login/pendaftaran Supabase sebenar, pengesahan emel, logout dan pengosongan cache sesi.
- Dashboard dan analitik menggunakan data backend.
- Inbox menggunakan 300 mesej terkini dalam susunan kronologi, polling 5 saat, toggle bot, balasan manusia dan simulator AI.
- Status `pending/sending/sent/failed`, ralat, bilangan cubaan dan Retry untuk balasan manusia yang gagal.
- `sent` bermaksud Meta menerima submission; bukan pengesahan diterima/dibaca pelanggan.
- Balasan manusia menggunakan ID permintaan untuk mengelakkan rekod berganda selepas respons hilang. Identiti permintaan dikekalkan dalam memori bagi draf semasa; refresh penuh menamatkan keadaan UI tersebut.
- Knowledge Base memuat naik bytes sebenar dahulu, merekod metadata kemudian, lalu memproses dokumen. PDF, DOCX, CSV dan TXT disokong, maksimum 10MiB. Objek yang belum direkod dibersihkan selepas kegagalan metadata.
- FAQ tambah/senarai/padam, system prompt, soalan belum dijawab dan penyelesaian kepada FAQ.
- Settings profil/WhatsApp dan pengurusan kunci AI admin melalui backend. Secrets tidak disimpan oleh adapter demo.

## Ujian

```bash
pnpm test
pnpm typecheck
pnpm build
```

20 ujian kod meliputi upload/cleanup, render status inbox dan handler penghantaran sebenar dengan dependencies dimock. Suite lokal memock DB/auth/provider. Verifikasi staging berasingan turut menguji PostgreSQL, RLS, Storage, authentication dan server functions sebenar; lihat laporan.

Suite browser menggunakan dua server lokal. Jalankan build tanpa konfigurasi Supabase untuk senario login tanpa konfigurasi yang diuji di sini:

```bash
pnpm exec playwright install chromium --only-shell
pnpm start
# Terminal kedua:
pnpm test:harness
# Terminal ketiga:
pnpm test:browser
```

`test:harness` menyajikan fixture komponen inbox pada port 5175. Fixture ini hanya untuk ujian dan tidak dimasukkan dalam route production. Browser suite menyemak login/redirect production serta interaksi komponen dengan callback simulasi. Ia bukan ujian WhatsApp atau Supabase hujung ke hujung.

## Jalankan semula ujian staging

Dua suite berikut mencipta akaun dan data sementara lalu membersihkannya. Gunakan hanya projek staging yang dibenarkan dan fail env peribadi. Skrip tidak memaparkan credentials.

```bash
STAGING_ENV_FILE=/path/to/staging.env pnpm test:staging:rls
# Aplikasi perlu berjalan di localhost:3000 menggunakan env staging sama.
STAGING_ENV_FILE=/path/to/staging.env pnpm test:staging:browser
```

Tetapkan `STAGING_APP_URL` jika origin aplikasi berlainan. Pasang Chromium seperti arahan ujian browser di atas. Untuk menjalankan aplikasi dengan fail env di luar folder projek:

```bash
OPENAI_API_KEY= AI_API_KEY= AI_BASE_URL= WHATSAPP_CRYPTO_KEY= node --env-file=/path/to/staging.env node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173
```

Override kosong itu memastikan senario ujian tidak menggunakan penyedia AI atau credentials WhatsApp sebenar. Login, data dashboard, Storage, pemprosesan TXT tanpa embedding dan penghantaran gagal masih menggunakan backend/DB staging sebenar.

## Sebelum closed beta

Jalankan ujian staging dengan dua akaun tenant: login sebenar, sekatan silang tenant, upload/download/proses Storage, mesej WhatsApp masuk, balasan bot, handoff, balasan manusia, forced failure dan Retry. Sahkan DB row, status UI dan mesej pada telefon pelanggan.

Schema Supabase staging telah dipasang dan diuji. Akaun, mesej dan objek Storage ujian telah dibersihkan; schema dan bucket dikekalkan. Tiada deployment aplikasi atau mesej WhatsApp sebenar dihantar. Background sweeper untuk `pending/sending` tersangkut, receipts delivered/read dan CI integration masih belum disediakan. Provider acceptance sebelum crash masih mempunyai risiko at-least-once pada sempadan Meta. Inbox memaparkan 300 mesej terkini; pagination sejarah lama belum disediakan.

Lihat `reports/VERIFICATION.md` untuk bukti semakan dan batasannya.

## Server lokal

`pnpm dev` kini menggunakan launcher `scripts/dev.mjs`, port tetap 3000 dan strictPort. Jika port sibuk, ia melaporkan ralat dan tidak berpindah ke port lain. Server perlu berjalan untuk laman lokal boleh dicapai.

Untuk menggunakan fail env sedia ada di luar folder aplikasi:

```bash
LOKALCHAT_ENV_FILE=/path/to/staging.env pnpm dev
```
