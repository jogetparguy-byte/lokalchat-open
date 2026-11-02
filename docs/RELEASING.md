# Pelepasan create-lokalchat

Pakej CLI berada dalam `packages/create-lokalchat`. Ia membundel snapshot aplikasi melalui allowlist; tiada clone GitHub, token atau sambungan database diperlukan oleh scaffolding. `template/` dijana semula oleh `prepack` dan tidak perlu dikomit.

## Persediaan dan semakan lokal

```sh
npm test --prefix packages/create-lokalchat
npm pack ./packages/create-lokalchat --pack-destination /tmp
# Gunakan nama tarball sebenar yang dipaparkan oleh npm pack:
npx --yes --package /tmp/create-lokalchat-0.1.0.tgz create-lokalchat /tmp/lokalchat-smoke --skip-install
cd /tmp/lokalchat-smoke
npm install --include=dev
npm test
npm run typecheck
npm run build
node scripts/audit-env.mjs
```

Ulang dengan direktori kosong unik setiap kali. Uji juga `npm run dev`, serta replay migration pada stack Supabase lokal Docker seperti [INSTALL.md](INSTALL.md). Build tanpa credentials tidak membuktikan login, RLS atau Storage hujung ke hujung. Rekod hasil sebenar sebelum release. npm memasang mengikut manifest dan menghasilkan package-lock; pnpm menggunakan lockfile yang dibundel.

Semak senarai dan kandungan tarball sebelum penerbitan: tiada `.env` sebenar, `.git`, `.supabase`/`.temp`, output build, reports dalaman atau credentials. `.env.example` sahaja dibundel; `.env` placeholder dicipta pada mesin pengguna. Semua perubahan aplikasi selepas pack memerlukan pack baharu. Kekalkan lesen AGPL-3.0-only dalam pakej dan template.

## Gate penerbitan manual

Semak pemilikan nama npm `create-lokalchat`, login/2FA maintainer dan versi unik. Dapatkan izin penerbitan sebelum `npm publish ./packages/create-lokalchat --access public`. Penerbitan registry adalah tindakan luaran berasingan daripada audit ini. Selepas diterbitkan, sahkan `npx create-lokalchat@latest <folder-baharu>` dari registry sebenar. Setakat pakej belum diterbitkan, arahan `@latest` belum disahkan dan tidak boleh dianggap tersedia.

Jangan push GitHub atau menulis semula sejarah Lovable tanpa arahan pengguna. Persediaan, pack dan ujian lokal tidak menerbitkan ke npm atau GitHub.
