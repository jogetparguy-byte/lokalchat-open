# Audit Supabase untuk pemasangan baharu

Audit statik dan ujian runtime disposable pada 2 November 2026. Ujian runtime menggunakan credentials yang dijana oleh stack lokal sahaja. Tiada sambungan ke Supabase hosted, production atau penghantaran WhatsApp dilakukan.

## Hasil semakan kod

- Sejarah canonical ialah 25 fail dalam `supabase/migrations`, mengikut urutan nama fail. Jangan jalankan `drizzle/migrations` sekali lagi: skema dashboard daripada sejarah itu telah dibawa ke migration `20261024090800_complete_dashboard_schema.sql`.
- Jadual asas `whatsapp_connections` diwujudkan sebelum migration yang mengubahnya. Skema meliputi semua jadual yang dirujuk aplikasi: profiles, chats, messages, knowledge_base, handoff_events, whatsapp_connections, kb_documents, platform_api_keys, internal_settings, unanswered_questions dan unanswered_question_occurrences.
- RLS diaktifkan pada semua jadual aplikasi tersebut. Polisi tenant menggunakan UUID pengguna; akses merentas tenant bagi admin diberikan secara eksplisit. Trigger `guard_profile_role` melindungi perubahan peranan oleh pengguna biasa.
- RPC carian vektor dan claim/finish mesej dihadkan kepada service role. Trigger signup tidak boleh dipanggil terus oleh peranan API. Search path fungsi carian merangkumi `extensions`.
- Akses browser kepada WhatsApp dihadkan kepada kolum metadata; token dan ciphertext tidak diberi SELECT kepada authenticated. `platform_api_keys` menggunakan polisi admin. Bucket `kb-documents` private dan polisi objek menggunakan folder UUID pengguna.
- Token hook dijana secara rawak dalam `internal_settings`; jadual itu tidak diberi akses PUBLIC/anon/authenticated. Migration tidak memasang cron atau membuat panggilan HTTP.
- Konfigurasi lokal tidak mengandungi ref projek hosted atau credentials. Seed dimatikan. `.env.example` mengandungi placeholder dan membezakan kunci public daripada service role. Service role digunakan oleh fail server sahaja.

Semakan ini menilai kod yang dihantar, bukan keselamatan database deployment yang mungkin mempunyai grants, policies, data atau migration history berbeza. Ia juga bukan pengesahan bahawa SQL telah berjaya direplay oleh Postgres.

## Pengesahan runtime disposable

Supabase Go CLI **2.83.0** diuji dengan Podman rootless melalui Unix socket proxy. Setiap run menggunakan project ID rawak, direktori `/tmp` berizin `0700`, konfigurasi HOME berasingan dan port rawak yang dipaksa kepada `127.0.0.1`. Suite tidak membaca `.env` atau menggunakan projek linked.

Pembaikan keserasian:

- Temporary helper tanpa nama diterima hanya apabila kedua-dua label projek tepat; proxy memberikan nama unik dalam projek ujian.
- Filter `all` pada operasi volume prune dibuang kerana Podman menolaknya. Query listing container `all=true` dikekalkan.
- Cleanup menerima tepat satu selector label projek; selector tambahan yang boleh meluaskan skop ditolak.
- Audit memahami medan network Podman `labels`, `id` dan `name` dalam huruf kecil. Setiap resource diperiksa sebelum stop dan ID/label direkod. Selepas stop, senarai container, volume dan network projek mesti kosong.

Keputusan fungsi yang telah diperhatikan:

- Dua fresh start berjaya; stop pertama serta audit loopback pada kedua-dua stack berjaya.
- Semua 25 migrations berjaya direplay dengan `db reset --local --no-seed`; sejarah versi sepadan tepat dengan fail canonical.
- Semakan skema backend, vector search 1536 dimensi, lease inbound/outbound, retry, uniqueness dan internal settings berjaya pada PostgreSQL sebenar.
- Semua 12 kumpulan ujian API berjaya: signup/login, password salah, dua tenant, pengasingan RLS dua hala, private Storage termasuk upsert/list/delete, akses anonymous, larangan self-promotion, perlindungan credentials dan concurrency RPC.
- Fixtures API dipadam dan bilangan `auth.users` kembali sifar sebelum stack dihentikan.
- `npm test`: 33 lulus; regression proxy: 2 lulus; scaffold CLI: 10 lulus; `npm run typecheck` lulus.

Status cleanup akhir dan ID/label resources direkod dalam [laporan mesin](../reports/DISPOSABLE_SUPABASE_RESULTS.json). Percubaan pertama gagal pada normalisasi audit network, bukannya startup SQL; pembaikan serta cleanup pemulihan direkod dalam [laporan percubaan awal](../reports/DISPOSABLE_SUPABASE_INITIAL_ATTEMPT.json). Orphan run terdahulu yang telah disahkan dibersihkan secara khusus dalam [manifest cleanup lama](../reports/PRIOR_DISPOSABLE_CLEANUP.json).

Jalankan semula hanya dengan CLI dan socket rootless lokal yang ditentukan secara eksplisit:

```sh
node --test tests/loopback-docker-proxy.test.mjs
node tests/run-disposable-supabase.mjs \
  --cli /path/to/supabase-2.83.0 \
  --docker-socket /path/to/rootless-podman.sock \
  --runtime podman
```

Ujian ini mengesahkan kontrak database/API backend dan ujian backend bermock. Penghantaran WhatsApp, provider AI, email sebenar, scheduler, Realtime, Edge Functions dan browser end-to-end tidak dijalankan. Keputusan lokal tidak membuktikan konfigurasi deployment hosted sama.

Admin, provider AI, WhatsApp dan scheduler tidak diaktifkan automatik. Setup integrasi memerlukan akaun/operator sendiri seperti diterangkan dalam panduan pemasangan.

Rujukan: [Supabase database migrations](https://supabase.com/docs/guides/local-development/database-migrations), [Supabase changelog](https://supabase.com/changelog).
