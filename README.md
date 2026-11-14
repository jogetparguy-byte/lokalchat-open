# LokalChat Open

Aplikasi ini terus mengalihkan `/` kepada `/auth` untuk log masuk atau daftar. Landing page diselenggara sebagai projek berasingan `lokalchat-landing` dan tidak dibundel dalam npm installer.

## Install untuk developer

```sh
npx lokalchat@latest my-lokalchat
cd my-lokalchat
npm run setup:local
```

CLI disediakan dalam `packages/create-lokalchat`; arahan registry `@latest` memerlukan penerbitan npm oleh maintainer terlebih dahulu. Ia belum diterbitkan oleh audit ini. Ikuti [panduan pemasangan baharu](docs/INSTALL.md) untuk Supabase lokal/hosted, semua migration, `.env`, dependencies dan pembaikan `vite: command not found`. Maintainer boleh menguji tarball sebelum publish melalui [panduan pelepasan](docs/RELEASING.md).

`npm run setup:local` menyediakan database pembangunan berasingan, menyemak migration/Auth/REST dan membuka app di `http://127.0.0.1:3000`. Muat turun pertama memerlukan internet dan boleh mengambil beberapa minit. Biarkan terminal terbuka; Ctrl+C menghentikan app dan database ini tanpa memadam data. Jalankan arahan sama untuk menyambung. Pilihan `--setup-local` pada installer menjalankan setup terus selepas dependencies siap.

Setup menggunakan Supabase CLI 3.0.0 yang dipinkan dan disahkan checksum serta **stack eksperimen**. Docker/Podman digunakan jika tersedia; native tersedia pada Linux glibc 2.35+ x64/arm64 atau macOS 14+ Apple silicon. Windows/Intel Mac memerlukan Docker/Podman yang berjalan. Native sesuai untuk satu projek berjalan bagi setiap environment. Gunakan `npm run setup:local -- --runtime native` untuk memilih native secara jelas. Setup ini untuk pembangunan sahaja; pengesahan emel dimatikan dalam konfigurasi lokal berasingan.

Fail `.env` dan konfigurasi Supabase asal dikekalkan. Konfigurasi peribadi dan data lokal berada dalam `.lokalchat/`, yang diabaikan Git. Jangan kongsi fail atau log di situ. Setup automatik memerlukan folder baharu tanpa `.env` tersuai. WhatsApp/AI masih memerlukan tetapan berasingan. Semak tanpa membuka app dengan `npm run setup:local -- --check`; hentikan database selepas launcher terhenti dengan `npm run stop:local`.


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

## Setup environment dan Supabase

`.env.example` menyenaraikan semua pemboleh ubah aplikasi dan skrip ujian dengan label **REQUIRED**, **CONDITIONAL**, **OPTIONAL** serta skop client/server/tooling. Nilai kosong bermaksud fungsi pilihan belum dikonfigurasi; semua nilai `REPLACE_ME` mesti diganti sebelum login. Template ini selamat di-commit. `.env`, `.env.local`, fail staging dan varian env lain diabaikan Git.

1. Sediakan projek Supabase pembangunan/staging yang schema dan bucketnya telah disediakan daripada sejarah migration repositori. Semak sejarah sedia ada bersama pemilik projek sebelum menerapkan apa-apa migration; menyalin `.env` tidak memasang schema. Audit konfigurasi ini tidak menjalankan migration.
2. Salin `.env.example` ke `.env`. Daripada Supabase Dashboard projek, ambil Project URL dan publishable key. Isi pasangan `VITE_SUPABASE_*` dan `SUPABASE_*` menggunakan projek yang sama. Lihat [panduan rasmi API keys](https://supabase.com/docs/guides/getting-started/api-keys).
3. Isi `SUPABASE_SERVICE_ROLE_KEY` dengan credential backend berkeistimewaan projek. Nama ini ialah nama yang dibaca kod sekarang; jangan tukar kepada `SUPABASE_SECRET_KEY` tanpa perubahan kod. Jangan guna credential ini dalam `VITE_*`, browser atau log. Akses ini memintas RLS.
4. Dalam Supabase Auth, tetapkan Site URL kepada origin aplikasi (lokal: `http://127.0.0.1:3000`) dan benarkan redirect `http://127.0.0.1:3000/dashboard`. Untuk deployment, gunakan origin HTTPS sendiri dan redirect `/dashboard`. Semak tetapan pengesahan emel; gunakan akaun ujian sendiri.
5. Jalankan `pnpm dev`. Restart selepas menukar env. `VITE_*` dimuatkan ketika build; perubahan production memerlukan build semula. Server secrets perlu dibekalkan kepada proses Node ketika runtime melalui `.env` atau secret manager hosting. `pnpm start` memuatkan `.env`; `pnpm build` tidak dengan sendirinya memuatkan semua secret server ke shell.

Keperluan mengikut fungsi:

| Fungsi | Konfigurasi | Skop / keperluan |
| --- | --- | --- |
| Login dan dashboard | Dua `VITE_SUPABASE_*`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Required; hanya pasangan `VITE_*` masuk browser |
| WhatsApp / kunci AI admin | `WHATSAPP_CRYPTO_KEY` | Server-only, conditional; jana secret rawak sendiri dan simpan dengan selamat, termasuk backup |
| AI chat | **Settings → Provider AI**, setiap akaun | Server-only; kunci daripada env pemasangan atau `platform_api_keys` tidak digunakan untuk permintaan pengguna |
| Provider AI admin | `GEMINI_BASE_URL`, `GEMINI_MODEL`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL` | Server-only, optional; default disenaraikan dalam template |
| Embedding knowledge base | API key OpenAI milik akaun dalam **Provider AI** | Optional; provider lain atau embedding gagal menggunakan carian keyword |
| Versi WhatsApp API | `WHATSAPP_GRAPH_VERSION` | Server-only, optional; default kod `v21.0`, keserasian Meta belum diuji dalam audit ini |
| Server dan ujian | Bahagian tooling/test dalam template | Optional; staging tests menulis data sementara, gunakan hanya projek yang dibenarkan |

Dalam Settings, simpan phone number ID, access token, app secret dan verify token WhatsApp; kod membacanya daripada `whatsapp_connections`, bukan env global. Gunakan callback HTTPS `/api/public/whatsapp` untuk Meta. Kunci AI admin disimpan terenkripsi dalam `platform_api_keys`. `WHATSAPP_CRYPTO_KEY` juga melindungi kunci ini; jangan putar nilainya tanpa re-encryption data sedia ada. `GEMINI_API_KEY` dan `DEEPSEEK_API_KEY` tidak dibaca oleh aplikasi.

Setiap pengguna yang sudah login mengisi **Settings → Provider AI** sendiri, tanpa role admin. Konfigurasi disimpan ke `.lokalchat/users/<hash-projek-auth>/<user-id>/.env`, dengan direktori `0700` dan fail `0600` pada POSIX. `LOKALCHAT_USER_ENV_DIR` boleh memilih direktori persisten lain; fail `.env` pemasangan dan `LOKALCHAT_ENV_FILE` tidak ditulis oleh borang. Hash projek Auth memastikan UUID yang sama dalam projek berbeza tidak berkongsi konfigurasi. Identiti diambil daripada sesi yang disahkan server, bukan input pengguna.

AI membaca konfigurasi pemilik perbualan pada setiap permintaan, termasuk webhook WhatsApp dan simulator. Tiada fallback kepada `AI_*`, `OPENAI_API_KEY` global atau `platform_api_keys`. Pengguna tanpa konfigurasi AI sendiri menerima aliran handoff sedia ada. Pengguna lama perlu mengisi semula key sendiri; konfigurasi pemasangan lama tidak disalin automatik kerana pemiliknya tidak dapat ditentukan dengan selamat. Embedding menggunakan key akaun yang memilih OpenAI; provider lain menggunakan keyword fallback. Simpanan hanya menyemak format; ia tidak menguji key, kredit atau keupayaan model. Key kosong dikekalkan hanya daripada fail pengguna sama bagi provider dan endpoint sama.

**Settings → Supabase** menyimpan profil URL dan key per akaun dalam fail peribadi yang sama. Key kosong dikekalkan hanya bagi projek sama dan akaun sama. Profil ini **belum menukar sambungan runtime**: login, dashboard, storage dan scheduled jobs masih menggunakan projek Supabase pemasangan dengan pengasingan data melalui RLS. Simpanan tidak memindahkan data, menguji credentials/schema atau menukar `.env` pemasangan. Pemilihan antara satu projek ber-RLS dan projek berasingan setiap akaun perlu diputuskan sebelum mengaktifkan sambungan per pengguna. Secret Supabase kekal di server; hanya status key tersimpan dipulangkan kepada browser.

`.env` pemasangan ialah konfigurasi infrastruktur bootstrap operator, termasuk Auth, service key dan encryption key. Ia tidak menjadi sumber API key AI pengguna. Restart/build diperlukan hanya apabila operator menukar infrastruktur atau `VITE_*`; perubahan Provider AI per akaun berkuat kuasa pada permintaan seterusnya. Setiap pemasangan atau mesin mesti mempunyai direktori konfigurasi persisten yang sesuai. Jangan dedahkan `.lokalchat/` melalui static hosting atau masukkannya dalam pakej open-source. Cache dashboard juga dipisahkan mengikut sesi akaun; pertukaran pengguna tidak mengguna semula data cache akaun terdahulu.

Token scheduled hook bukan env: `weekly_report_token` berada dalam `public.internal_settings` (akses service role sahaja). Cron membaca token pada runtime dan menghantarnya sebagai `x-report-token` ke `/api/public/hooks/weekly-report`. Menyalin template tidak mengaktifkan scheduler.

Untuk audit semula tanpa membaca `.env` atau menghubungi DB:

```bash
node scripts/audit-env.mjs
```

Semakan membandingkan rujukan env literal dalam kod aplikasi, skrip, ujian dan config dengan template (termasuk pilihan yang dikomen), mengesan nama hilang/tidak digunakan/duplikasi, dan mengesahkan peraturan Git ignore. Ia tidak mengesahkan credential atau sambungan provider. `SUPABASE_ANON_KEY` dan `VITE_SUPABASE_ANON_KEY` hanya alias fallback ujian RLS; login aplikasi memerlukan nama publishable key.

Jalankan `npm run setup:check` untuk membaca konfigurasi sendiri secara offline dan menolak placeholder, URL/key client-server tidak sepadan serta privileged keys dalam pemboleh ubah public. Nilai credentials tidak dicetak. Lihat [audit Supabase pemasangan baharu](docs/SUPABASE_AUDIT.md) untuk skop semakan statik dan ujian database yang masih diperlukan.

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

Suite ujian kod meliputi upload/cleanup, render status inbox, handler penghantaran sebenar dengan dependencies dimock, dan keselamatan konfigurasi environment. Suite lokal memock DB/auth/provider. Verifikasi staging berasingan turut menguji PostgreSQL, RLS, Storage, authentication dan server functions sebenar; lihat laporan.

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
