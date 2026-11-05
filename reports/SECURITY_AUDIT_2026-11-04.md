# Audit keselamatan LokalChat — 4 November 2026

## Keputusan

**Belum boleh diluluskan sebagai selamat untuk production.** Semakan kod dan ujian setempat mengenal pasti **2 isu High, 3 isu Medium dan 1 perkara hardening Low**. Tiada kebocoran rahsia sebenar atau akses silang akaun yang berjaya dibuktikan dalam skop yang diuji. Itu bukan bukti bahawa sistem bebas kelemahan: ujian RLS melalui servis sebenar, Semgrep dan pangkalan advisory npm masih belum lengkap.

Audit ini menilai working tree `/home/irsyad_b/lokalchat-open`, termasuk perubahan belum commit, berasaskan HEAD `054ffa7150a85ad04856a99a6672e5f0f4e67524`. Kod aplikasi tidak dibaiki, dependencies tidak dinaik taraf, dan tiada deployment, penghantaran mesej sebenar atau perubahan database pengguna dilakukan. Artifak audit dan skrip pembuktian ditambah dalam `reports/`.

Keutamaan High mengandaikan penggunaan internet dengan beberapa akaun tidak saling dipercayai. Konteks deployment telah ditanya tetapi belum dijawab. Untuk pemasangan peribadi pada loopback sahaja, peluang serangan jarak jauh lebih rendah; kelemahan kod yang dijelaskan masih wujud.

## Ringkasan penemuan

| ID | Tahap | Penemuan | Tahap pengesahan |
| --- | --- | --- | --- |
| SEC-001 | High | Semakan DNS outbound tidak mengikat sambungan kepada IP yang disahkan | Kod dan probe deterministik; serangan rebinding sebenar tidak dilakukan |
| SEC-002 | High | DOCX boleh berkembang jauh melebihi had upload dan memakan sumber proses bersama | Probe selamat: 12,456 bait menjadi 12,582,912 aksara |
| SEC-003 | Medium | Kandungan ralat provider dan kandungan simulator boleh memasukkan data sensitif ke log | Kebocoran penanda sintetik ke log dibuktikan |
| SEC-004 | Medium | Tiada had sumber menyeluruh untuk pemprosesan, badan webhook dan respons outbound | Semakan kod; had di proxy/hosting belum diketahui |
| SEC-005 | Medium | Respons SSR aplikasi tidak menetapkan CSP, perlindungan framing dan beberapa security header | Respons handler build diuji; header dari proxy/edge belum diketahui |
| SEC-006 | Low / hardening | Logout tidak memberikan jaminan pembatalan serta-merta bagi JWT yang masih sah | Laluan middleware disahkan; replay token sebenar selepas logout belum diuji |

## High

### SEC-001 — DNS disemak berasingan daripada sambungan sebenar

**Lokasi:** `src/lib/ssrf.server.ts:46`, `src/lib/ssrf.server.ts:85`, `src/lib/agent.server.ts:127`, `src/lib/agent.server.ts:187`.

`assertPublicHttpUrl()` menyemak rekod A melalui Cloudflare DoH, kemudian memulangkan URL dengan hostname asal. `fetch()` berikutnya menggunakan resolver dan sambungan sendiri. Rekod AAAA tidak disemak dan tiada dispatcher/lookup yang mengikat sambungan kepada jawapan DNS yang telah disahkan. Pemeriksaan semula pada setiap request masih tidak menghapuskan jurang antara semakan dan sambungan.

**Senario:** pengguna sah mengawal domain endpoint inventori. Jawapan kepada DoH ialah IP awam, tetapi resolver proses atau jawapan seterusnya menunjuk ke servis dalaman. Laluan inventori membenarkan HTTP, jadi sekatan sijil HTTPS pada custom LLM tidak melindungi laluan tersebut. Respons inventori boleh kembali ke model dan balasan chat. Kesan bergantung pada servis dalaman yang boleh dicapai dan sekatan egress deployment; tiada metadata cloud atau data dalaman sebenar diambil dalam audit ini.

**Kawalan sedia ada:** literal loopback/private, beberapa nama hos dalaman dan protokol selain HTTP(S) ditolak. Redirect pada gateway LLM dan inventori ditolak. Lapan variasi URL berbahaya, termasuk bentuk integer dan hexadecimal loopback, ditolak dalam probe.

**Pembaikan:** selesaikan dan sahkan semua A/AAAA; paksa sambungan menggunakan alamat yang telah disahkan sambil mengekalkan Host/SNI yang betul. Gunakan polisi egress yang menolak loopback, private dan metadata sebagai lapisan tambahan. Kekalkan penolakan redirect. Uji pertukaran DNS, split DNS dan alamat IPv6 pada tahap sambungan sebenar.

Rujukan: [OWASP SSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).

### SEC-002 — Had upload tidak mengehadkan pengembangan DOCX

**Lokasi:** `src/lib/kb-extract.server.ts:18`, `src/lib/kb-extract.server.ts:46`, `src/lib/lokalchat.functions.ts:693`.

Saiz objek Storage disemak sebelum dan selepas download, tetapi `unzipSync(bytes)` mengembangkan semua entri tanpa had jumlah bait, jumlah entri atau nisbah mampatan. Ia berjalan dalam proses aplikasi. `chunkText()` membina semua chunk sebelum memulangkan 200 yang pertama. Tiada had saiz teks hasil extraction atau pengasingan worker dalam laluan ini.

**Bukti:** arkib sintetik 12,456 bait yang mengandungi teks berulang dalam `word/document.xml` menghasilkan 12,582,912 aksara. Ujian berhenti pada 12 MiB; tiada cubaan menghabiskan RAM atau menjatuhkan servis. Arkib ini jauh di bawah had upload 10 MiB.

**Kesan:** pengguna sah boleh menghantar dokumen kecil yang menyebabkan penggunaan memori/CPU besar dan mengganggu akaun lain pada proses yang sama. Saiz upload yang betul serta RLS tidak mengawal pengembangan mampatan.

**Pembaikan:** ekstrak hanya entri yang diperlukan dengan had bait sebenar semasa decoding; hadkan jumlah entri, saiz setiap entri, jumlah saiz hasil, jumlah teks dan kerja parser. Jalankan parser dalam worker dengan had memori/masa. Hentikan pembinaan chunk sebaik had dicapai. Kunci pemprosesan setiap dokumen dan hadkan concurrency per akaun.

[OWASP File Upload](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) mengesyorkan had selepas decompression. `fflate` menyediakan [filter extraction](https://github.com/101arrowz/fflate/blob/master/README.md), tetapi filter metadata sahaja bukan pengganti had decoding sebenar. [Isu upstream #298](https://github.com/101arrowz/fflate/issues/298) turut melaporkan allocation ZIP64 besar dalam 0.8.3; kes 4 GiB itu sengaja tidak dijalankan.

## Medium

### SEC-003 — Data sensitif boleh memasuki log

**Lokasi:** `src/lib/embeddings.server.ts:30`, `src/lib/agent.server.ts:211`, `src/lib/agent.server.ts:316`, `src/lib/whatsapp.server.ts:101`, `src/lib/error-capture.ts:18`.

Embedding mencetak badan ralat provider secara terus. Gateway LLM memasukkan badan ralat ke dalam `Error`, kemudian mencetaknya. Logger umum mengembangkan mesej, stack dan cause tanpa redaction. Laluan simulator dry-run turut mencetak nombor penerima dan teks balasan penuh.

**Bukti:** respons 401 provider tiruan yang mengandungi penanda API key sintetik muncul dalam log sebenar fungsi embedding. Tiada provider sebenar dihubungi. Ini membuktikan laluan logging tidak menyaring kandungan; ia tidak membuktikan provider sebenar pernah mengembalikan atau membocorkan key pengguna.

**Kesan:** key yang dipantulkan provider, prompt, teks pelanggan atau maklumat peribadi boleh disalin ke sistem log dan backup dengan sempadan akses/retention berbeza daripada aplikasi.

**Pembaikan:** log hanya status, kod ralat yang dibenarkan dan ID korelasi. Jangan log badan provider, Authorization, key atau kandungan chat. Gunakan logger berstruktur dengan redaction dan had panjang; pastikan simulator tidak mencetak PII secara lalai. Tambah ujian penanda sensitif untuk semua laluan ralat, bukan penghantaran WhatsApp sahaja.

### SEC-004 — Had sumber dan quota belum menyeluruh

**Lokasi:** `src/routes/api/public/whatsapp.ts:43`, `src/lib/lokalchat.functions.ts:360`, `src/lib/lokalchat.functions.ts:671`, `src/lib/agent.server.ts:137`, `src/lib/embeddings.server.ts:18`.

Badan webhook dibaca dan diparse sebelum signature disahkan, tanpa had eksplisit di handler. Simulator tidak menetapkan had panjang mesej server. Pemprosesan dokumen boleh diminta semula tanpa claim/status lock. Inventori mempercayai `Content-Length` sebelum membaca keseluruhan respons; header boleh tiada atau palsu. Embedding tidak menetapkan timeout. Tiada quota atau limiter aplikasi ditemui pada laluan ini; ralat 429 provider bukan limiter aplikasi.

**Kesan:** request besar, pemprosesan berulang atau endpoint lambat boleh menahan worker, membesarkan memori/database dan meningkatkan penggunaan API. Kunci AI milik akaun mengehadkan perkongsian kos key, tetapi sumber proses masih dikongsi. Had sebenar dari CDN/proxy belum disahkan. Tiada load test atau DoS sebenar dilakukan.

**Pembaikan:** hadkan badan sebelum buffering; semak kewujudan/format signature awal dan kekalkan pengesahan HMAC atas bait asal. Tetapkan had mesej, quota per akaun/IP, claim pemprosesan dokumen dan concurrency. Hadkan bait respons secara streaming, tetapkan timeout embedding dan budget keseluruhan request. Sertakan quota Storage/Data API kerana client boleh mengakses servis itu terus.

### SEC-005 — Security header belum ditetapkan oleh handler SSR

**Lokasi:** `src/server.ts:47`, `vite.config.ts:9`, `src/routes/__root.tsx:131`, `src/integrations/supabase/previewAuthStorage.ts:18`.

Handler SSR daripada build production dipanggil terus tanpa socket. `/`, `/auth` dan `/dashboard` memulangkan 200 dengan `Content-Type`, tanpa `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` atau `Permissions-Policy`. `/dashboard` memaparkan shell semakan sesi, bukan data chat tanpa login.

**Kesan:** pertahanan terhadap framing dan akibat XSS tidak dibekalkan pada sempadan SSR yang diuji. Session browser disimpan melalui localStorage di luar preview, jadi XSS yang berlaku melalui kelemahan lain boleh mengakses token. Tiada stored XSS daripada teks chat dibuktikan; teks chat dirender melalui escaping React.

**Pembaikan:** tambah header pada sempadan aplikasi atau edge dan uji respons akhir yang diterima browser. Rancang `frame-ancestors` mengikut keperluan preview Lovable. CSP perlu mengambil kira script bootstrap tema dan sumber font; jangan memecahkan hydration dengan polisi yang tidak diuji. Penilaian deployment berubah jika proxy memang telah menetapkan header ini.

## Low / hardening

### SEC-006 — Semantik pembatalan sesi perlu diputuskan untuk operasi sensitif

**Lokasi:** `src/integrations/supabase/auth-middleware.ts:92`, `src/lib/lokalchat.functions.ts:1067`, `src/lib/lokalchat.functions.ts:1091`, `src/components/lokalchat/SettingsPanels.tsx:758`.

Middleware menerima hasil `getClaims()` yang sah tanpa pemeriksaan eksplisit bahawa `session_id` masih aktif. Dalam pengesahan JWT tempatan, token yang dicuri dan belum luput boleh terus memenuhi pemeriksaan ini selepas logout. Probe dengan claims tiruan mengesahkan pergantungan middleware itu; ia bukan ujian replay sesi sebenar atau kelemahan tandatangan JWT.

Ini ialah sifat biasa sistem JWT, bukan bukti authentication bypass. [Dokumentasi Supabase](https://supabase.com/docs/guides/auth/sessions) menerangkan semakan `session_id` terhadap `auth.sessions` jika pembatalan serta-merta diperlukan. Tetapkan jangka masa risiko yang boleh diterima dan tambah pemeriksaan sesi/re-auth khusus untuk perubahan key atau tindakan admin jika diperlukan. Semakan server function sahaja tidak membatalkan token pada laluan Data API/Storage secara automatik.

## Kawalan yang ditemui dan diuji

- Semua 34 server function dalam `lokalchat.functions.ts` menggunakan `requireSupabaseAuth`. Fungsi admin membuat semakan role server; laluan penghantaran privileged menyemak pemilik chat sebelum service-role RPC.
- Fail konfigurasi AI/Supabase per akaun menggunakan UUID yang disahkan serta namespace projek Auth. Ujian dua akaun, tiada fallback key global, key retention, traversal dan symlink lulus. Ini tidak bermaksud projek Supabase persendirian setiap pengguna sudah aktif: runtime masih menggunakan projek pemasangan ber-RLS.
- HMAC webhook menolak signature hilang, salah dan diubah sebelum ingestion. Probe sah menggunakan pemilik daripada connection server, bukan `business_id` yang dihantar penyerang.
- AES-256-GCM menggunakan IV rawak dan menolak ciphertext yang diubah. Fail `.lokalchat/local.env` semasa mempunyai mode 0600; nilai key tidak dicetak atau dimasukkan dalam laporan.
- Migration akhir menghidupkan RLS untuk semua 11 jadual aplikasi. Polisi tenant mengandungi ownership predicate; RPC penghantaran/vector dan `internal_settings` mempunyai ACL terhad. Grant WhatsApp client dihadkan kepada metadata yang selamat. Ini disahkan pada source dan katalog database sementara, bukan akses melalui servis live.
- Chat, FAQ dan nama pelanggan yang disemak menggunakan rendering teks React. Script tema ialah string aplikasi tetap; komponen chart dengan raw CSS tidak mempunyai caller aplikasi ditemui. Tiada penemuan XSS dibuat semata-mata kerana adanya `dangerouslySetInnerHTML`.
- Profil Supabase per akaun disimpan sebagai konfigurasi persendirian; UI menerangkan bahawa profil itu belum menukar Auth/data/Storage runtime. Egress chat kepada provider AI pilihan pemilik ialah aliran produk yang disengajakan; semakan ini tidak mengesahkan retention atau latihan data pihak provider.

## Bukti dan keputusan alat

| Semakan | Keputusan dan batas |
| --- | --- |
| `npm test` | 109 lulus, 0 gagal. Campuran unit dan mock/VM; bukan 109 ujian end-to-end |
| TypeScript | `node node_modules/typescript/bin/tsc --noEmit` lulus |
| Build production | Lulus dalam salinan sementara dengan env sintetik dan dependencies sedia ada; amaran bundler `use client` direkodkan |
| Kebocoran build | Tiga penanda rahsia server tiada dalam 21 fail public build; pemeriksaan tambahan 81 fail server juga tiada padanan |
| Rahsia semasa | Tiada padanan nilai key server semasa dalam 25 fail di `public/` dan `.output/public`; hanya nama variable dan path direkodkan |
| Gitleaks sejarah | 3 commit tersedia pada semua refs tempatan, repo bukan shallow, 0 padanan; refs jauh tidak di-fetch |
| Gitleaks working tree | Snapshot 245 fail, 1 padanan ditriage sebagai false positive dalam ayat laporan `reports/LLM_SETTINGS_2026-11-03.md:29`; tiada literal credential pada ayat itu |
| Gitleaks artifak audit | 8 padanan tambahan ialah nilai SHA-256 dalam manifest source, semuanya disahkan semula terhadap bait fail; 0 rahsia sebenar |
| Probe tambahan | 7 probe lulus; beberapa probe membuktikan kelemahan semasa, bukan mengesahkan kod sudah selamat |
| PostgreSQL sementara | PostgreSQL 17.11 + pgvector: 25 migration canonical, kontrak schema/vector/delivery dan semakan katalog lulus; platform Auth/Storage menggunakan schema bootstrap minimum |
| RLS silang akaun live | **Belum disahkan.** Socket Unix ditolak dengan EPERM. Mod PostgreSQL single-user memaksa kuasa superuser, maka percubaan `SET ROLE` tidak diterima sebagai ujian RLS dan tidak dikira sebagai kelemahan aplikasi |
| Semgrep | **Tidak dijalankan.** Skill ada tetapi CLI tiada. `uv tool run --from semgrep ...` gagal resolve PyPI. Pro tidak dapat diperiksa, tiada ruleset dijalankan, tiada SARIF/keputusan bersih dicipta |
| `npm audit` | **Gagal menghubungi registry** dengan EAI_AGAIN. Audit advisory semua dependencies belum lengkap |
| Advisory TanStack | Versi dipasang: react-start 1.168.60 dan start-server-core 1.169.39, melepasi pembaikan advisory XSS dan deserialization yang disemak. 25 manifest TanStack semasa tiada tiga indikator khusus kompromi Mei yang diperiksa; ini bukan pelepasan keselamatan keseluruhan host |
| Pakej installer | `npm pack --dry-run --ignore-scripts` menyenaraikan 187 fail bagi create-lokalchat 0.2.0; tiada private env, `.lokalchat`, `.git`, node_modules atau log dalam manifest. Pakej tidak diterbitkan |
| Env/Git hygiene | Semakan shell mengesahkan path env peribadi diabaikan dan contoh tidak diabaikan; tiada private env tracked. `scripts/audit-env.mjs` tidak selesai kerana child Git berasaskan stdin tersekat; dihentikan, bukan dilaporkan lulus |
| Supabase connector | Penyenaraian projek berjaya tetapi tiada projek aktif yang dapat dipadankan dengan konfigurasi lokal. Tiada customer rows, logs atau schema projek lain dibaca |
| Diff | `git diff --check` lulus; snapshot perbandingan mengesahkan tiada source aplikasi berubah semasa audit |
| Knowledge graph | `graphify update .` berjaya tanpa LLM: 1,457 nod dan 3,115 edge |

Rujukan advisory yang disemak: [XSS GHSA-qx66-fv34-fjm8](https://github.com/TanStack/router/security/advisories/GHSA-qx66-fv34-fjm8), [deserialization GHSA-9m65-766c-r333](https://github.com/TanStack/router/security/advisories/GHSA-9m65-766c-r333), [kompromi pakej GHSA-g7cv-rxg3-hmpx](https://github.com/TanStack/router/security/advisories/GHSA-g7cv-rxg3-hmpx).

Artifak yang boleh disemak berada dalam [security-2026-11-04/](security-2026-11-04/). Manifest SHA-256 mengikat bukti kepada snapshot source. Raw log, salinan build dan cluster ujian berada dalam direktori persendirian `/tmp/lokalchat-security-2026-11-04/`; jangan jadikan seluruh direktori sementara itu bahan publish.

## Perkara yang masih diperlukan

1. Jawab konteks penggunaan: lokal sahaja, sasaran internet, atau production aktif; nyatakan sempadan pengguna yang dipercayai. Model ancaman dalam folder bukti masih **draf**, bukan keputusan muktamad.
2. Sediakan CLI Semgrep dan akses registry/rules. Selepas prerequisite tersedia, plan dengan target, engine, mode dan ruleset mesti ditunjukkan serta diluluskan sebelum scan, seperti diwajibkan [skill Semgrep](../../.agents/skills/semgrep/SKILL.md).
3. Lengkapkan audit npm/OSV bagi kedua-dua lockfile dan tree dependencies yang digunakan untuk release. Carian web beberapa advisory tidak menggantikan semakan ini.
4. Jalankan ujian disposable Supabase melalui Auth, PostgREST, Storage dan Realtime sebenar: kedua-dua arah tenant A/B, anon, perubahan role, operasi file dan RPC privileged. Jangan jalankan fixtures pada database pelanggan.
5. Sahkan konfigurasi deployment sebenar: migration history/ACL/RLS, secret handling, header/proxy, TLS, egress, quota, Auth CAPTCHA/MFA, session expiry, Storage visibility dan polisi backup/log. Audit ini tidak membuat dakwaan tentang OS laptop, firewall, platform hosting atau salinan installer/app lain.
6. Baiki SEC-001 dan SEC-002 dahulu, kemudian logging dan budget sumber. Ulang probe yang berkaitan selepas setiap pembaikan; hasil semasa tidak boleh dianggap sebagai pengesahan pembaikan.

Tiada audit boleh menjanjikan sifar kesilapan atau sifar kelemahan. Kesimpulan laporan ini dihadkan kepada bukti, snapshot dan semakan yang benar-benar berjaya dijalankan.
