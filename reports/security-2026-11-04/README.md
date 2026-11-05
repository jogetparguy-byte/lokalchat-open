# Bukti audit keselamatan — 4 November 2026

Laporan utama: [SECURITY_AUDIT_2026-11-04.md](../SECURITY_AUDIT_2026-11-04.md).

| Fail | Kandungan |
| --- | --- |
| `validation.json` | Keputusan alat, skop dan semakan yang belum selesai |
| `security-probes.mjs` | Tujuh probe dengan data sintetik, tanpa sambungan rangkaian atau database |
| `security-probes.json` | Keputusan probe; beberapa kejayaan membuktikan kelemahan yang masih wujud |
| `ssr-runtime.json` | Status/header tiga halaman dan handshake webhook daripada handler build |
| `current-secret-exposure.json` | Mode fail dan klasifikasi key; tiada nilai key disimpan |
| `tanstack-current-manifests.json` | Versi 25 manifest dan pemeriksaan tiga indikator khusus advisory supply chain |
| `source-sha256.json` | Hash 245 fail snapshot sebelum artifak audit ditambah |
| `lokalchat-open-threat-model.DRAFT.md` | Model ancaman sementara; konteks deployment belum disahkan pengguna |

## Menjalankan semula probe

Dependencies projek mesti sudah dipasang. Jalankan dari root repo:

```bash
node reports/security-2026-11-04/security-probes.mjs "$PWD"
```

Probe memanggil fungsi source melalui transpilation dan VM dengan dependencies luaran dimock. Ia tidak membuka socket, menghubungi provider, menghantar WhatsApp atau menggunakan key sebenar. Data DOCX ujian dihadkan kepada 12 MiB hasil. Output menulis semula `security-probes.json` dalam folder skrip; `LOKALCHAT_AUDIT_OUTPUT` boleh memilih direktori output lain yang sudah wujud.

**Tafsiran:** PASS bagi probe kelemahan bermaksud sifat tidak selamat semasa berjaya dibuktikan. Selepas membaiki sifat itu, assertion probe tersebut perlu dikemas kini menjadi ujian penolakan yang sesuai. Jangan menganggap semua PASS sebagai kelulusan keselamatan.

## Semakan yang belum lengkap

Semgrep belum berjalan kerana CLI tiada dan pemasangan PyPI gagal DNS. Engine Pro dan semua ruleset belum diuji. Pelan scan belum diluluskan; tiada SARIF dihasilkan. `npm audit` gagal EAI_AGAIN. Ujian RLS melalui Auth/Data API/Storage/Realtime sebenar belum dibuat kerana sandbox menyekat socket.

Database sementara hanya mengesahkan 25 migration, schema/vector/delivery contract dan katalog polisi. Standalone PostgreSQL memaksa kuasa superuser; keputusan `SET ROLE` dalam mod itu tidak boleh digunakan untuk menilai RLS. Tiada fixtures dimasukkan ke database sebenar pengguna.

Raw log/build/harness PostgreSQL disimpan dalam `/tmp/lokalchat-security-2026-11-04/` yang bermode 0700. Bukti di sini tidak menyimpan nilai credentials sebenar. Direktori sementara boleh hilang selepas restart; artifak ringkasan dan reproducer dalam repo ini kekal.
