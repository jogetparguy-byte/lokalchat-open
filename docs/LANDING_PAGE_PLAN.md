# Pelan landing page LokalChat

Tarikh: 3 November 2026  
Status terkini: Iterasi pertama sudah dibina. Pengguna kemudian memilih kandungan English dan memberikan rujukan visual gelap/hijau. Arahan tersebut menggantikan cadangan salinan BM dan komposisi hero di bawah. Butiran hasil dan batas pengesahan: `reports/LANDING_PAGE_IMPLEMENTATION_2026-11-03.md`. Baki dokumen ini ialah rekod cadangan fasa pertama.

## Skop dan sumber

Repo aktif ialah `/home/irsyad_b/lokalchat-open`. Salinan di `Projects/` bukan sasaran perubahan ini. Graphify digunakan untuk mencari route dan komponen berkaitan sebelum membaca kod.

Imbasan ini memfokuskan landing page, identiti visual, destinasi tindakan dan kod ciri yang akan disebut dalam pemasaran. Ia bukan audit keseluruhan aplikasi atau ujian integrasi langsung.

| Perkara | Bukti dalam repo |
| --- | --- |
| Landing page sedia ada | `src/routes/index.tsx` |
| React 19, TanStack Start/Router, Tailwind 4 | `package.json` |
| Logo rasmi tersedia | `src/components/lokalchat/BrandLogo.tsx`, `public/lokalchat-official.jpg` |
| Warna teal, latar cerah, fon Bricolage Grotesque dan Plus Jakarta Sans | `src/styles.css`, `src/routes/__root.tsx` |
| Sasaran PKS Malaysia | Metadata landing page dan `SYSTEM_PROMPT` dalam `src/lib/agent.server.ts` |
| Arahan bahasa BM pasar, English dan Manglish | `SYSTEM_PROMPT`; belum dinilai melalui ujian bahasa dalam fasa ini |
| Carian FAQ kedai | `searchFaq()`, dengan carian semantik dan fallback kata kunci |
| Semakan stok melalui API kedai | `checkStock()`; memerlukan `inventory_api_url` yang dikonfigurasi dan boleh dicapai |
| Serah perbualan kepada manusia | `triggerHumanHandoff()` dan kawalan bot dalam `ChatWindow.tsx` |
| FAQ boleh dimasukkan oleh pemilik | `src/components/lokalchat/FaqSection.tsx` |
| Inbox dan ruang balas pemilik tersedia | `dashboard_.inbox.tsx`, `ChatWindow.tsx` |
| Destinasi masuk aplikasi tersedia | `/auth` dan `/dashboard` |

## Penemuan pada halaman sekarang

- Hero menyebut nama produk sahaja. Manfaat produk bergantung pada perenggan sokongan.
- Gradient hero, badge huruf besar dan kad ikon berulang menjadikan susunannya mudah terasa seperti templat.
- Tiada paparan produk atau demonstrasi perbualan dalam route landing sekarang. Folder `public/` hanya mengandungi aset logo/favicon ketika diperiksa.
- Kedua-dua tindakan hero membawa pelawat ke aplikasi atau auth sebelum mereka melihat cara produk bekerja.
- Istilah seperti “RAG FAQ” dan “pgvector” menerangkan pelaksanaan, sedangkan pembaca utama ialah pemilik kedai.

Semakan `lint.mjs` pada `src/routes/index.tsx` melaporkan **3 FAIL, 1 WARN**: dua pembahagi nipis, satu label kecil huruf besar dan amaran `h-screen`. Ini dapatan linter gaya skill, bukan laporan kerosakan fungsi. Tiada skor visual atau keputusan responsif diberikan kerana browser belum digunakan.

## Arah yang dicadangkan

Pilihan skrip: `one-motif`, `colour-chapters`, `type-only-statement`. Cadangan: **One motif**, seed `1400919668`. Artefak arahnya disimpan dalam `.taste-skill/direction.json`.

Idea: **Perbualan BM/Manglish kedai LokalChat menjadi bahan utama halaman, dari soalan pelanggan hingga pemilik mengambil alih.**

Gunakan bentuk gelembung daripada identiti/perbualan produk sebagai satu motif yang membawa kandungan. Bentuk itu menjadi pentas untuk demo perbualan dan potongan inbox. Keistimewaannya datang daripada ayat, keputusan FAQ dan pertukaran bot kepada pemilik yang benar-benar milik aliran LokalChat.

Kekalkan logo rasmi, teal dan dua fon jenama. Gunakan bidang warna rata, teks yang jelas, komposisi besar dan kandungan produk sebagai fokus. Susunan telefon perlu direka sendiri supaya demo dan tindakan kekal mudah dicapai.

Satu redraw hero dibuat: blueprint asal `striped-card-beside-room` mengandaikan bilik dan jalur fizikal yang tiada dalam produk. Penggantinya `giant-cropped-shape` menyokong motif jenama tanpa fotografi rekaan. Blueprint bahagian lain masih calon; pada fasa reka bentuk, padankan semula mana-mana yang mengandaikan statistik, borang, foto atau aset yang belum tersedia. Footer menggunakan logo rasmi, tanpa melukis semula wordmark.

## Cadangan kandungan

Hero:

> WhatsApp kedai, lebih terurus
>
> LokalChat bantu PKS Malaysia menjawab FAQ WhatsApp dalam BM dan Manglish, dengan pemilik mengambil alih apabila perlu.

Tindakan utama: **Cuba demo**, menuju demo setempat dalam halaman. Tindakan navigasi: **Log masuk**, menuju `/auth`.

| Bahagian | Perkara yang pelawat perlu faham | Bukti yang akan ditunjukkan |
| --- | --- | --- |
| Hero dan demo | Produk membantu mengurus pertanyaan WhatsApp kedai | Contoh perbualan dengan soalan BM/Manglish dan jawapan berdasarkan FAQ contoh |
| Jawapan kedai anda | Pemilik membekalkan kandungan jawapan | Potongan UI FAQ dan kaitannya dengan jawapan demo |
| Bila pemilik ambil alih | Perbualan boleh diserahkan kepada manusia | Permintaan pelanggan bercakap dengan pemilik, status bot berhenti dan paparan inbox |
| Sambungan stok | Semakan stok bergantung pada sistem kedai | Penjelasan syarat sambungan API; demo stok hanya menggunakan data contoh yang dilabel |
| Cara bermula dan FAQ | Pelawat tahu persediaan yang diperlukan | Sambungan WhatsApp, kandungan FAQ, konfigurasi AI dan inventori jika digunakan |
| Penutup | Pelawat boleh mencuba contoh atau masuk aplikasi | Tindakan konsisten dan logo rasmi |

Demo interaktif menggunakan beberapa senario terkawal: pertanyaan penghantaran, stok dan permintaan bercakap dengan pemilik. Labelkan sebagai contoh. Ia tidak menghantar mesej WhatsApp atau memanggil AI berbayar. Gunakan data rekaan kedai contoh, bukan perbualan atau nombor telefon pelanggan sebenar.

Harga, testimoni, logo pelanggan, bilangan pengguna, kadar kejayaan dan jaminan uptime belum dibuktikan dalam fasa ini. Kandungan itu tidak menjadi asas reka bentuk. Kemampuan yang ditemukan dalam kod tidak membuktikan integrasi produksi sedang tersambung.

## Pelaksanaan berperingkat

1. **Imbasan dan arah:** dokumen ini, bukti ciri dan pilihan komposisi.
2. **Hero dan demo:** bina bahagian pertama menggunakan stack sedia ada supaya arah visual boleh dilihat secara konkrit.
3. **Halaman lengkap:** sambung naratif FAQ, handoff, stok dan persediaan menggunakan komposisi berlainan mengikut kandungan.
4. **Pengesahan:** production build, typecheck, pautan dan demo berfungsi, keyboard, reduced motion, serta pemeriksaan screenshot pada 1440, 768 dan 390 piksel. Jalankan linter/inspector skill dan kemas kini Graphify selepas perubahan kod.

Fasa pertama tidak mengubah kod aplikasi. Belum ada keputusan ujian build, browser atau integrasi baharu untuk dilaporkan.
