# Pemasangan LokalChat Open

Perlukan Node.js 22.13+ atau versi 24 ke atas (Node 23 tidak disokong; Node 24 LTS disyorkan), npm atau pnpm. Aplikasi ini menggunakan server Node/Nitro; hosting statik sahaja tidak mencukupi.

```sh
npx lokalchat@latest my-lokalchat
cd my-lokalchat
```

Arahan registry ini tersedia **selepas maintainer menerbitkan pakej npm**. Untuk menguji pakej sebelum diterbitkan, lihat [RELEASING.md](RELEASING.md). Installer memasang dependencies termasuk Vite dan menyalin `.env.example` ke `.env`. Scaffolding tidak menghubungi database. Pilihan: `--package-manager pnpm`, `--skip-install`, `--setup-local`. Direktori bukan kosong ditolak. Jika install gagal, fail projek dikekalkan untuk percubaan semula.

## Setup lokal automatik

Dalam folder aplikasi baharu, jalankan:

```sh
npm run setup:local
```

Atau gunakan `--setup-local` semasa menjalankan installer untuk setup terus selepas dependencies siap. Pilihan ini tidak boleh digabungkan dengan `--skip-install`.

Launcher memuat turun Supabase CLI **3.0.0** daripada release rasmi dan menyemak SHA-256 yang dipinkan. Kemudian ia menyediakan database berasingan, menerapkan migration, menyemak sejarah migration serta Auth/REST, menyimpan konfigurasi peribadi dan membuka app di `http://127.0.0.1:3000`. Daftar akaun ujian sendiri. Tiada akaun admin, pelanggan, sambungan WhatsApp atau kunci AI dibekalkan.

Muat turun pertama boleh mengambil beberapa minit. Setiap proses setup dan permintaan health menunggu sehingga 15 minit. Tiada percubaan berulang automatik. Biarkan terminal terbuka; Ctrl+C menghentikan app dan database ini tanpa memadam data. Jalankan arahan sama untuk menyambung.

Setup menggunakan [Supabase stacks eksperimen](https://supabase.com/docs/guides/local-development/running-multiple-local-projects). Runtime `auto` memilih Docker/Podman yang menjawab atau native pada sistem yang disokong. Menurut [keperluan runtime rasmi](https://supabase.com/docs/guides/local-development/docker-and-native-runtimes), native memerlukan Linux glibc 2.35+ (x64/arm64) atau macOS 14+ Apple silicon; Windows/Intel Mac memerlukan Docker/Podman yang berjalan. Native sesuai untuk satu projek berjalan bagi setiap environment. Untuk native secara jelas: `npm run setup:local -- --runtime native`. Runtime disimpan selepas setup pertama; gunakan folder baharu jika mahu runtime lain. Sekurang-kurangnya 1.5 GB ruang kosong disemak; muat turun servis atau imej Docker mungkin memerlukan lebih ruang.

`.env` dan `supabase/config.toml` asal tidak diubah. Semua state, cache CLI, konfigurasi dan log peribadi berada dalam `.lokalchat/`, yang diabaikan Git. Launcher menggunakan `.lokalchat/local.env` untuk app. Ia menolak `.env` tersuai atau fail override `.env.*` supaya tetapan hosted sedia ada tidak tercampur. Gunakan folder pemasangan baharu untuk setup ini. Jangan kongsi `local.env` atau `setup-private.log`; log mungkin mengandungi kunci.

Pengesahan emel dimatikan hanya dalam konfigurasi database lokal berasingan. Ini untuk pembangunan pada komputer sendiri, bukan deployment production. Tiada `login`, `link`, `db reset`, `db push`, `--remote` atau operasi cloud dijalankan oleh launcher.

Arahan tambahan:

```sh
npm run setup:local -- --help
npm run setup:local -- --check  # Sediakan dan semak, kemudian hentikan database tanpa membuka app.
npm run stop:local             # Hentikan database ini selepas launcher keluar; data dikekalkan.
```

Jika menggunakan pnpm, gunakan `pnpm run setup:local` dan hantar flag terus, contohnya `pnpm run setup:local --runtime native`. Jika port 3000 sibuk, hentikan app lain dalam terminalnya dahulu. Selepas gangguan kuasa, lock lama mungkin kekal: sahkan proses setup sudah tiada sebelum membuang `.lokalchat/setup.lock`. Jangan buang folder data database untuk membaiki lock.

## Supabase lokal secara manual

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
npm run setup:check
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

Halaman login menyekat penghantaran borang apabila konfigurasi public kosong, masih mengandungi `REPLACE_ME`, atau URL tidak sah. Ini semakan offline sahaja; URL dan key yang kelihatan sah belum membuktikan sambungan database.

`npm run setup:check` menyemak `.env` secara offline tanpa mencetak nilainya: placeholder, padanan URL/public key client-server dan service role/secret key yang tersalah masuk ke pemboleh ubah `VITE_*`. Ia juga menyemak overrides dalam environment proses. `LOKALCHAT_ENV_FILE` boleh memilih fail konfigurasi lain. Semakan ini tidak mengesahkan kesahihan key atau status migrations. Jika secret pernah dibundel dalam `VITE_*`, keluarkannya dan putar secret melalui operator projek sebelum build semula.

Jika `vite: command not found` atau launcher melaporkan Vite tiada, jalankan dari direktori aplikasi:

```sh
npm install --include=dev
# atau: pnpm install --frozen-lockfile --prod=false
```

Vite ialah devDependency yang diperlukan untuk dev/build. Jangan guna `npm install --omit=dev` pada peringkat build. Folder asal tanpa `node_modules` belum sedia dijalankan. Node di bawah 22.13 dan Node 23 tidak disokong. Restart selepas perubahan `.env`; build semula apabila `VITE_*` berubah. `npm start` memerlukan hasil build dan memuatkan `.env` untuk server.

## Admin, integrasi dan secrets

Admin tidak dijana automatik. Selepas mendaftar, operator database boleh menaikkan **UUID akaun sendiri yang telah disahkan** kepada `admin` melalui SQL editor projek development: kemas kini `public.profiles.role` untuk satu `profiles.id` tersebut. Jangan ubah migration lama atau mempercayai metadata yang boleh diedit pengguna untuk memberi peranan.

Setiap pengguna yang sudah login membuka **Tetapan Perniagaan → Provider AI** untuk mengisi provider, ID model dan API key sendiri. Server menyimpan konfigurasi ke `.lokalchat/users/<hash-projek-auth>/<user-id>/.env`; direktori `0700` dan fail `0600` pada POSIX. Tetapkan `LOKALCHAT_USER_ENV_DIR=/path/ke/storan-persisten` untuk direktori lain. Identiti mesti datang daripada sesi Auth yang disahkan, dan hash projek Auth mengasingkan UUID yang sama dalam projek berbeza. LLM, webhook, simulator dan embedding menggunakan key pemilik masing-masing. Tiada fallback kepada kunci global dalam `.env`, `OPENAI_API_KEY` atau `platform_api_keys`; pengguna lama perlu memasukkan key sendiri. Key kosong mengekalkan key pengguna sama hanya bagi provider/endpoint sama. Pengguna tanpa key tidak boleh menggunakan key pengguna lain dan aliran handoff chatbot kekal tersedia.

**Tetapan Perniagaan → Supabase** menyimpan profil sambungan per akaun dalam fail yang sama. Ia tidak menukar sambungan runtime aplikasi atau fail env pemasangan. Login, database, storage dan jobs masih menggunakan projek pemasangan ber-RLS. Sambungan projek berasingan setiap pengguna belum diaktifkan sementara pilihan seni bina ini menunggu penetapan. Profil tidak menguji credentials/schema, menjalankan migration, memindahkan data atau mencipta akaun. Ambil keys daripada [panduan API keys Supabase](https://supabase.com/docs/guides/getting-started/api-keys). Secret/service-role key hanya untuk server; browser menerima status tersimpan sahaja.

`.env` atau `.lokalchat/local.env` kekal sebagai konfigurasi bootstrap operator untuk Auth/infrastruktur; borang pengguna tidak menulisnya lagi. `LOKALCHAT_ENV_FILE` memilih fail bootstrap untuk launcher sahaja. Konfigurasi pengguna yang lama tersimpan dalam fail pemasangan tidak dipindahkan automatik kerana tiada maklumat pemilik yang boleh dipercayai. Simpanan Provider AI per akaun tidak memerlukan restart. Perubahan operator pada infrastruktur memerlukan restart dan perubahan `VITE_*` memerlukan build semula. Jika konfigurasi bootstrap menghalang login, operator perlu membetulkannya secara lokal.

Storan fail per pengguna perlu persisten serta dilindungi daripada static hosting, Git dan npm bundle. Bagi beberapa server, sediakan storan kongsi yang menyokong exclusive file creation dan atomic rename. Sokongan fail lokal ini bukan secret manager berpusat; operator filesystem boleh membaca credentials. Cache browser dashboard diasingkan mengikut akaun untuk mengelakkan pemaparan tetapan pengguna terdahulu selepas pertukaran sesi.

Jana `WHATSAPP_CRYPTO_KEY` sendiri apabila memerlukan WhatsApp atau kunci AI dalam admin, contohnya `openssl rand -hex 32`. Simpan backup; menukarnya memerlukan re-encryption credentials tersimpan. Setiap akaun memerlukan konfigurasi Provider AI sendiri melalui Settings. Credentials WhatsApp diisi melalui Settings dan disimpan terenkripsi. Jangan mencuba penghantaran sebenar tanpa akaun/provider ujian sendiri.

Migration menyediakan token hook rawak dalam `public.internal_settings`, dengan akses service role sahaja. Ia tidak mengaktifkan cron. Scheduler dan callback HTTPS memerlukan setup deployment berasingan; jangan hardcode token atau URL production dalam migration.
