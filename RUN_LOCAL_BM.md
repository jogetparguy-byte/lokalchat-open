# Jalankan LokalChat dari USB

Folder ini ialah salinan aplikasi terbaru. Folder backend/HTML/ZIP lama dikekalkan.

## Komputer ini

Buka Terminal dan jalankan:

```bash
bash "/run/media/daniel_019/New Volume/Projects/lokalchat/lokalchat/lokalchat-app/RUN_LOCAL.sh"
```

Kemudian buka http://127.0.0.1:3000/auth dan log masuk menggunakan akaun sendiri.

Biarkan terminal terbuka sepanjang aplikasi digunakan. Tekan Ctrl+C untuk menghentikan server. Jangan cabut USB semasa server berjalan kerana konfigurasi env dibaca dari USB.

## Cara launcher berfungsi

USB menggunakan exFAT. Launcher menyegerakkan source ke folder runtime lokal di bawah ~/Documents/Codex/.lokalchat-runtime-* supaya node_modules dan symlink tidak perlu disimpan di USB. Fail USB tidak dipadam oleh penyegerakan ini. Jika mengubah kod, ubah source dalam folder USB dan jalankan launcher semula.

Dependencies pada komputer ini sudah disediakan. Pada komputer baharu, pasang Node.js 24 atau lebih baru, pnpm dan rsync dahulu. Jika dependencies belum ada, launcher menjalankan pnpm install --frozen-lockfile; internet diperlukan.

Launcher membaca konfigurasi sedia ada daripada ../lokalchat-backend/.env. Jangan padam fail itu. Untuk menggunakan fail env lain:

```bash
LOKALCHAT_ENV_FILE="/path/to/private.env" bash "/path/to/lokalchat-app/RUN_LOCAL.sh"
```

Jika port 3000 sudah digunakan, hentikan server LokalChat lama dengan Ctrl+C dahulu. Launcher tidak berpindah ke port lain secara senyap.

Jika nama mount USB berubah pada komputer lain, ubah path arahan kepada lokasi RUN_LOCAL.sh yang sebenar.
