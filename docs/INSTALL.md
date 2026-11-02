# Pemasangan LokalChat Open

Perlukan Node.js >=22.12 (Node 24 LTS disyorkan), npm atau pnpm, serta projek Supabase sendiri. Aplikasi ini menggunakan server Node/Nitro; hosting statik sahaja tidak mencukupi.

```sh
npx create-lokalchat@latest my-lokalchat
cd my-lokalchat
```

Arahan registry ini tersedia **selepas maintainer menerbitkan pakej npm**. Untuk menguji pakej sebelum diterbitkan, lihat [RELEASING.md](RELEASING.md). Installer memasang dependencies termasuk Vite, menyalin `.env.example` ke `.env`, dan tidak menghubungi database. Pilihan: `--package-manager pnpm`, `--skip-install`. Direktori bukan kosong ditolak. Jika install gagal, fail projek dikekalkan untuk percubaan semula.

## Supabase lokal (disyorkan untuk pembangunan)

Pasang Docker dan Supabase CLI mengikut [panduan rasmi](https://supabase.com/docs/guides/local-development/cli/getting-started). Jalankan dari direktori aplikasi yang dijana. Jangan jalankan `supabase init` kerana konfigurasi sudah disertakan.

```sh
supabase --help
supabase start --help
supabase start
supabase status
```

`start` pada stack baharu menerapkan migration dalam `supabase/migrations`. Untuk menguji replay semua migration pada **database lokal yang boleh dibuang**, semak bantuan kemudian jalankan:

```sh
supabase db reset --help
supabase db reset --local
supabase migration list --local
```

Reset memadam data lokal. Jangan tambah `--linked` atau `--db-url`. Jangan sambungkan installer kepada production. Hanya sejarah `supabase/migrations` adalah canonical; jangan jalankan migration Drizzle tambahan pada database sama. Tiada seed pelanggan atau admin dibekalkan.

Daripada output `supabase status`, isi `.env` secara peribadi:

| Pemboleh ubah | Nilai |
| --- | --- |
| `VITE_SUPABASE_URL`, `SUPABASE_URL` | API URL yang sama, biasanya `http://127.0.0.1:54321` |
| `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_PUBLISHABLE_KEY` | Publishable key, atau anon key JWT lokal jika versi CLI menyediakan format legacy |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role/secret key backend sahaja |

Jangan salin output status ke issue atau log CI. Semua `VITE_*` dihantar ke browser: jangan letakkan service role atau secret key di situ. `.env` mesti kekal diabaikan Git. Placeholder `REPLACE_ME` mesti diganti. Jangan guna credentials projek asal.

Auth lokal dibekalkan dengan origin `http://127.0.0.1:3000` dan redirect `/dashboard`. Daftar akaun melalui aplikasi. Jika pengesahan emel aktif, buka peti emel lokal melalui URL yang dipaparkan oleh CLI. Akaun baharu mendapat peranan `sme`. AI dan WhatsApp boleh dibiarkan belum dikonfigurasi untuk ujian login/dashboard kosong.

## Projek Supabase hosted baharu

Cipta projek development kosong milik sendiri. Gunakan CLI untuk `supabase link --help`, `supabase db push --help` dan `supabase migration list --help`; link hanya kepada ref projek development yang telah disahkan. Semak `supabase db push --dry-run` sebelum `supabase db push`. Langkah ini ialah tindakan manual operator dan tidak dijalankan oleh installer. Jangan reset atau menolak sejarah penuh ke database production/sedia ada tanpa audit sejarah migration.

Isi URL dan keys daripada Dashboard, tetapkan Auth Site URL kepada origin aplikasi dan redirect yang dibenarkan kepada `<origin>/dashboard`. Gunakan HTTPS untuk deployment. Semak grants Data API dan RLS jika projek baharu tidak mendedahkan jadual secara automatik. Rujuk [migrations rasmi](https://supabase.com/docs/guides/local-development/database-migrations) dan [keselamatan Data API](https://supabase.com/docs/guides/api/securing-your-api).

## Jalankan dan semak

```sh
npm run dev
# http://127.0.0.1:3000
```

```sh
npm test
npm run setup:check
npm run typecheck
npm run build
npm start
node scripts/audit-env.mjs
```

Dengan pnpm, gunakan `pnpm dev`, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm start`. Jangan jalankan suite `test:staging:*` sebelum meluluskan projek ujian sendiri; suite itu menulis data sementara. Ujian unit biasa menggunakan mock dan tidak memerlukan credentials.

`npm run setup:check` menyemak `.env` secara offline tanpa mencetak nilainya: placeholder, padanan URL/public key client-server dan service role/secret key yang tersalah masuk ke pemboleh ubah `VITE_*`. Ia juga menyemak overrides dalam environment proses. `LOKALCHAT_ENV_FILE` boleh memilih fail konfigurasi lain. Semakan ini tidak mengesahkan kesahihan key atau status migrations. Jika secret pernah dibundel dalam `VITE_*`, keluarkannya dan putar secret melalui operator projek sebelum build semula.

Jika `vite: command not found` atau launcher melaporkan Vite tiada, jalankan dari direktori aplikasi:

```sh
npm install --include=dev
# atau: pnpm install --frozen-lockfile --prod=false
```

Vite ialah devDependency yang diperlukan untuk dev/build. Jangan guna `npm install --omit=dev` pada peringkat build. Folder asal tanpa `node_modules` belum sedia dijalankan. Node di bawah 22.12 juga tidak disokong. Restart selepas perubahan `.env`; build semula apabila `VITE_*` berubah. `npm start` memerlukan hasil build dan memuatkan `.env` untuk server.

## Admin, integrasi dan secrets

Admin tidak dijana automatik. Selepas mendaftar, operator database boleh menaikkan **UUID akaun sendiri yang telah disahkan** kepada `admin` melalui SQL editor projek development: kemas kini `public.profiles.role` untuk satu `profiles.id` tersebut. Jangan ubah migration lama atau mempercayai metadata yang boleh diedit pengguna untuk memberi peranan.

Jana `WHATSAPP_CRYPTO_KEY` sendiri apabila memerlukan WhatsApp atau kunci AI dalam admin, contohnya `openssl rand -hex 32`. Simpan backup; menukarnya memerlukan re-encryption credentials tersimpan. AI memerlukan konfigurasi provider sendiri seperti `.env.example`. Credentials WhatsApp diisi melalui Settings dan disimpan terenkripsi. Jangan mencuba penghantaran sebenar tanpa akaun/provider ujian sendiri.

Migration menyediakan token hook rawak dalam `public.internal_settings`, dengan akses service role sahaja. Ia tidak mengaktifkan cron. Scheduler dan callback HTTPS memerlukan setup deployment berasingan; jangan hardcode token atau URL production dalam migration.
