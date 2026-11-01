# Diagnosis rangkaian dan pengesahan inbox — 1 November 2026

## Punca yang dibuktikan

Kegagalan berlaku dalam sandbox shell Codex yang mempunyai polisi rangkaian restricted. Ia bukan bukti kerosakan DNS Fedora pada host.

- Fedora Linux 44; Node v24.21.0; pnpm 12.11.2.
- Registry npm: https://registry.npmjs.org/ (betul).
- /etc/resolv.conf mempunyai resolver 1.1.1.3, 1.0.0.3 dan alamat IPv6 berkaitan. Fail ini dibaca sahaja.
- getent tidak dapat resolve registry.npmjs.org; curl memberi `Could not resolve host`.
- TCP terus ke 1.1.1.1:443 dan 104.16.24.34:443 ditolak dengan PermissionError / Errno 1 / Operation not permitted. Oleh itu DNS bukan satu-satunya sekatan.
- UDP ke 1.1.1.3:53 ditolak dengan Operation not permitted.
- Bind socket 127.0.0.1 dan 0.0.0.0 juga ditolak. Ini menghalang server browser lokal.
- ip/netlink, NetworkManager dan system bus tidak boleh dicapai dalam sandbox. Keadaan rangkaian host tidak dapat disahkan.

## Tindakan minimum

Tiada pembaikan konfigurasi Fedora diperlukan berdasarkan bukti yang tersedia. Tiada perubahan /etc/resolv.conf, NetworkManager, registry, TLS atau proxy dibuat. Menukar DNS tidak akan membuang sekatan socket sandbox. Eskalasi shell tidak tersedia dalam polisi sesi ini; sekatan tidak dipintas.

XDG_RUNTIME_DIR=/tmp digunakan pada proses pnpm sahaja, untuk mengelakkan lock directory runtime yang tidak boleh ditulis. Ini bukan pembaikan rangkaian dan tidak mengubah konfigurasi sistem.

Percubaan pnpm install --frozen-lockfile dengan store tempatan masih gagal resolve registry. Ia dihentikan selepas 15 saat untuk mengelakkan ulangan muat turun yang diketahui gagal. Dependencies kekal kosong. Tiada upgrade dependency dibuat.

## Pengesahan

| Semakan | Keputusan sesi ini |
| --- | --- |
| pnpm install --frozen-lockfile | Terhalang rangkaian; percubaan dihentikan, exit 124 |
| pnpm test | Terhalang pemasangan automatik dependencies; tidak mencapai runner ujian |
| pnpm typecheck | Terhalang dependencies; belum disahkan |
| pnpm build | Terhalang dependencies; belum disahkan |
| pnpm test:harness | Terhalang dependencies; bind localhost juga ditolak |
| pnpm test:inbox-route | Belum mencapai runner; tidak dianggap lulus |
| pnpm test:browser | Belum mencapai runner; tidak dianggap lulus |
| Assertion/pemeriksaan native Node | 23 lulus, 0 gagal |
| node --check lima skrip ujian MJS | 5 lulus, 0 gagal |

Setiap percubaan script pnpm dibatasi 5 saat selepas pemasangan sudah diketahui mustahil. Exit 124 ialah timeout perintah, bukan keputusan ujian kod. Suite pnpm test mengandungi 29 ujian (upload 5, inbox 5, backend 15, delivery-error 4): 0 dijalankan dalam sesi ini. Route suite mempunyai dua senario utama dan suite browser lima; semua belum disahkan.

SHA256 pnpm-lock.yaml sebelum/selepas sama:
`f05308416793de80c0175dd99fec0d42d08b2d8a4c5f924b6acc92d73d677fac`

## Audit subagen

Dua subagen menjalankan audit baca sahaja ujian dan keselamatan/kestabilan. Tiada regresi baharu yang konkrit ditemui; ini tidak menggantikan ujian runtime.

- Auth, tenant guard dan claim atomik dikekalkan.
- Server menapis ralat dan UI tidak memaparkan teks provider mentah.
- Timeout selepas Meta menerima boleh menghasilkan penghantaran pendua apabila pengguna retry. Ini batas sedia ada, bukan jaminan exactly-once.
- Finalize gagal boleh meninggalkan status sending tanpa reconciliation/sweeper.
- Unit/route mock tidak membuktikan RLS sebenar, webhook Meta atau delivered/read.
- Route test mempunyai potensi race assertion refresh; hanya baiki jika execution membuktikannya. Tiada assertion dipadam.

## Fail berubah dalam sesi ini

- reports/NETWORK_AND_VERIFICATION_2026-11-01.md (laporan ini).
- Nota serta indeks memori Obsidian di luar projek.

Kod aplikasi, ujian, lockfile, USB asal dan backend berasingan tidak diubah. Tiada .env dibaca, DB diakses, migration atau deployment dijalankan.

## Langkah seterusnya

Jalankan perintah berikut pada terminal host atau sesi yang membenarkan rangkaian dan localhost, dalam /home/irsyad_b/Projects/lokalchat-open:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
```

Kemudian jalankan pnpm test:harness pada port 5175, pnpm test:inbox-route, dan server app tanpa konfigurasi production pada port 3000 untuk pnpm test:browser. Jangan jalankan test:staging:* terhadap production.

LokalChat Open belum boleh dianggap stabil sebelum suite penuh dan build lulus. Tiada keputusan ujian yang belum dijalankan dilabel lulus.
