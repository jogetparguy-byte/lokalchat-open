# Laporan verifikasi LokalChat

Tarikh: 24 Oktober 2026 (Asia/Kuala_Lumpur).

## Skop dan pelaksanaan

Tiga agent bekerja serentak dengan pemilikan fail khusus:

1. Shell aplikasi, authentication Supabase sebenar, adapter server functions, dashboard dan admin.
2. Inbox, status penghantaran, Retry, draf dan kawalan permintaan.
3. Knowledge Base/upload, FAQ, Settings dan soalan belum dijawab.

Agent utama menyatukan aplikasi, memasang dependencies, menyediakan migration bucket, menyemak semula kod dan menjalankan verifikasi. Review tambahan oleh agent menemui bug yang kemudian diperbaiki dan diuji semula.

## Pembetulan hasil review

- Pertanyaan 300 mesej terawal ditukar kepada 300 terkini; hasil dipulangkan secara kronologi dengan susunan tie yang tetap.
- Kegagalan menyimpan status delivery tidak lagi dilaporkan sebagai status akhir yang pasti.
- Respons penghantaran gagal yang sudah disimpan membawa ID mesej supaya UI menawarkan Retry tanpa membuat rekod baharu.
- ID permintaan + indeks unik melindungi balasan manusia daripada permintaan HTTP berulang/concurrent. ID yang digunakan dengan teks berlainan ditolak.
- Respons tidak pasti mengekalkan draf dan ID permintaan; pengguna boleh menyemak/mencuba semula operasi yang sama.
- Submit handler turut menyekat penghantaran ketika Retry berjalan.
- Ujian Chromium menemui ralat hydration ketika redirect auth berlaku semasa hydration. Guard kini mengesahkan sesi dalam effect selepas mount dan tidak merender route dalaman sebelum pengesahan. Semua server functions masih memerlukan auth server.
- Bucket Storage private ditambah sebagai migration; versi migration baharu dibezakan (`090600`, `090700`).

## Keputusan

- TypeScript seluruh aplikasi: **lulus**.
- Build client + SSR + Nitro preset `node-server`: **lulus**.
- Upload helper: **5/5 lulus**. Type/saiz/path, upload sebelum metadata, kegagalan upload, cleanup dan ralat cleanup.
- Render inbox: **5/5 lulus**. Label status, Retry hanya failed human, pengecualian customer/system, disabled state dan escaping ralat.
- Handler backend: **10/10 lulus**. Request berulang/concurrent, teks tidak sepadan, tenant check, latest 300, ralat finalization, provider failure, retry concurrent dalam row sama, sekatan tenant dan jenis/status yang tidak boleh diretry.
- Browser: **5/5 semakan lulus**. Login tanpa konfigurasi disekat; route terlindung redirect; persisted failure membersihkan draf dan Retry mengemas kini bubble sama; respons tidak pasti menggunakan ID sama; lebar telefon tanpa overflow atau browser runtime error.
- Semakan visual screenshot telefon: login dan fixture inbox diperiksa.
- Semakan asset JavaScript awam: tiada rujukan `SUPABASE_SERVICE_ROLE_KEY`, `WHATSAPP_CRYPTO_KEY`, `AI_API_KEY` atau akses server `DATABASE_URL` ditemui. Ini bukan audit keselamatan menyeluruh.

## Verifikasi staging sebenar selepas pengguna memberi kebenaran

Pengguna mengesahkan projek dalam fail env USB sebagai staging/test. Identiti URL API, browser dan sambungan PostgreSQL disahkan merujuk projek yang sama.

Pada permulaan, schema aplikasi belum dipasang; hanya dua jadual lama tersedia dan auth.users kosong. Semua 25 migration Supabase dipasang dalam satu transaksi. Dua jadual lama tidak disentuh dan bilangan rekodnya kekal. Percubaan awal menemui carian operator pgvector yang tidak menyertakan schema extensions dan rollback sepenuhnya; migration dibetulkan sebelum transaksi berjaya dikomit.

Migration tambahan menyelesaikan schema dashboard yang dahulu hanya ada dalam Drizzle. Tiada pg_cron/pg_net atau jadual penghantaran automatik diaktifkan.

**PostgreSQL/PostgREST/Storage: 8 kumpulan verifikasi lulus.**

1. Dua pengguna sebenar boleh mengurus baris tenant sendiri serta upload/download TXT private.
2. RLS dua hala menyekat read/update/delete silang tenant bagi profiles/chats/messages/FAQ/dokumen, termasuk insert dengan business_id/chat_id tenant lain.
3. Storage menyekat download/upload/list di folder tenant lain.
4. Akses anonim kepada data/fail private disekat.
5. RPC delivery service-role ditolak kepada user/anon; lima claim serentak hanya memberi satu pemenang; retry dan bilangan cubaan konsisten.
6. Indeks unik bot menolak reply berulang untuk inbound yang sama.
7. Indeks unik client_request_id manusia menerima hanya satu daripada lima insert serentak bagi permintaan sama.
8. Tenant tidak boleh menaikkan peranannya sendiri kepada admin.

**Browser aplikasi terhadap backend staging sebenar: 8 semakan lulus.**

1. Login Supabase sebenar dan dashboard authenticated.
2. Balasan manual tanpa sambungan WhatsApp disimpan sebagai failed.
3. Retry mengemas kini row DB sama dan menaikkan attempts tanpa menambah bubble/row.
4. FAQ disimpan melalui server function authenticated.
5. Upload TXT, download Storage, extraction dan penyimpanan chunk knowledge berfungsi tanpa provider embedding.
6. Settings menyimpan perubahan profil.
7. SME ditolak daripada halaman admin.
8. Tiada browser runtime error dalam aliran tersebut.

Ujian staging menemui isu borang login boleh digunakan sebelum hydration selesai. Inputs/submit kini menunggu mount. Guard admin juga dipindahkan kepada pemeriksaan role selepas authentication browser supaya hard refresh tidak kehilangan bearer session.

**Cleanup disahkan:** auth users, profiles, chats, messages, knowledge rows, dokumen dan objek bucket ujian semuanya kembali kepada 0. Schema 25 migration dan bucket private dikekalkan. Credentials dibaca daripada fail asal; tiada env sebenar disalin ke source deliverable.

## Batasan yang masih tinggal

Penghantaran Meta WhatsApp sebenar, jawapan daripada provider AI dan embedding provider belum diuji. Kunci AI dan kunci enkripsi WhatsApp dalam env sumber masih placeholder; tenant sementara sengaja tidak mempunyai sambungan WhatsApp. Tiada pelanggan dihubungi.

Pendaftaran/pengesahan emel belum diuji; akaun sementara diwujudkan melalui Auth admin dengan email_confirm=true supaya tiada emel dihantar. Login menggunakan password tetap melalui Supabase Auth sebenar.

Background sweeper untuk pending/sending tersangkut, receipts delivered/read, pagination melebihi 300 mesej dan pipeline CI masih belum disediakan. Tiada aplikasi diterbitkan/deploy ke hosting.
