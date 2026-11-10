# Pelepasan create-lokalchat

Pakej CLI berada dalam `packages/create-lokalchat`. Ia membundel snapshot aplikasi melalui allowlist; tiada clone GitHub, token atau sambungan database diperlukan oleh scaffolding. `template/` dijana semula oleh `prepack` dan tidak perlu dikomit.

## Persediaan dan semakan lokal

```sh
npm test --prefix packages/create-lokalchat
npm pack ./packages/create-lokalchat --pack-destination /tmp
# Gunakan nama tarball sebenar yang dipaparkan oleh npm pack:
npm run test:package --prefix packages/create-lokalchat -- /tmp/lokalchat-0.2.0.tgz
npx --yes --package /tmp/lokalchat-0.2.0.tgz lokalchat /tmp/lokalchat-smoke --skip-install
cd /tmp/lokalchat-smoke
npm install --include=dev
npm test
npm run typecheck
npm run build
node tests/local-setup.test.mjs
node scripts/audit-env.mjs
npm run setup:local -- --help
npm run setup:local -- --check
# Selepas semakan berjaya, jalankan app dan uji daftar/login/logout/login semula:
npm run setup:local
```

Ulang dengan direktori kosong unik setiap kali. Uji `--setup-local` installer serta setup lokal daripada pakej sebenar seperti [INSTALL.md](INSTALL.md). Ujian launcher menggunakan servis simulasi dan tidak menggantikan replay migration atau ujian browser terhadap runtime sebenar. Build tanpa credentials tidak membuktikan login, RLS atau Storage hujung ke hujung. Rekod hasil sebenar sebelum release, termasuk sistem operasi/runtime yang belum diuji. npm dan pnpm menggunakan lockfile yang dibundel.

`test:package` menggunakan tarball sebenar melalui `npm exec`, iaitu executor bagi `npx`. Cache sementara berasingan dan mod offline mengelakkan kebergantungan kepada registry. Semakan ini menguji `--help`, `--version`, completions, folder lalai `lokalchat-app`, folder dengan ruang, `.env` placeholder dan penolakan folder bukan kosong. Ia tidak menjalankan pemasangan dependencies app atau menyentuh database.

Semak senarai dan kandungan tarball sebelum penerbitan: tiada `.env` sebenar, `.git`, `.lokalchat`, `.supabase`/`.temp`, output build, reports dalaman atau credentials. `.env.example` sahaja dibundel; `.env` placeholder dicipta pada mesin pengguna. Semua perubahan aplikasi selepas pack memerlukan pack baharu. Kekalkan lesen AGPL-3.0-only dalam pakej dan template.

## Gate penerbitan manual

Semak pemilikan nama npm `lokalchat`, login/2FA maintainer dan versi unik. `E404` daripada registry bermakna pakej tidak dapat ditemukan; ia tidak menjamin nama akan diluluskan atau boleh didaftarkan. Jika sudah wujud, semak maintainer sebelum meneruskan. Jangan kongsi token atau kod OTP dalam chat.

```sh
npm view lokalchat name version dist-tags maintainers --json --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
# Jika belum login, jalankan secara interaktif pada terminal sendiri:
npm login --registry=https://registry.npmjs.org/
```

Dapatkan izin penerbitan sebelum arahan publish. Terbitkan **tarball sama yang telah disemak**, bukannya folder sumber yang boleh berubah selepas audit. Semakan dry-run tidak menerbitkan pakej dan tidak membuktikan hak akaun untuk menerbitkan.

```sh
npm publish /tmp/lokalchat-0.2.0.tgz --dry-run --ignore-scripts --access public --tag latest --registry=https://registry.npmjs.org/
# Hanya selepas mendapat izin penerbitan:
npm publish /tmp/lokalchat-0.2.0.tgz --ignore-scripts --access public --tag latest --registry=https://registry.npmjs.org/
```

Flag `--ignore-scripts` mengelakkan lifecycle scripts dijalankan semula semasa menerbitkan snapshot yang telah dipack dan diuji. `--tag latest` menjadikan versi ini sasaran `@latest`. Jangan pack semula atau ubah tarball selepas semakan; perubahan memerlukan pack dan semakan baharu.

Selepas diterbitkan, semak versi dan uji dalam folder baharu di luar repo sumber:

```sh
npm view lokalchat@latest version --registry=https://registry.npmjs.org/
npx lokalchat@latest
cd lokalchat-app
npm run setup:local
```

Penerbitan registry adalah tindakan luaran berasingan daripada audit ini. Setakat pakej belum diterbitkan, arahan `@latest` belum disahkan dari registry dan tidak boleh dianggap tersedia.

Jangan push GitHub atau menulis semula sejarah Lovable tanpa arahan pengguna. Persediaan, pack dan ujian lokal tidak menerbitkan ke npm atau GitHub.

## Release daripada GitHub

Workflow `.github/workflows/npm-release.yml` menguji PR/main dan manual dispatch tanpa publish.
Tag stabil `vX.Y.Z` sahaja menerbitkan package `lokalchat`, selepas ujian aplikasi,
typecheck, build, audit env, ujian installer dan smoke tarball. Publish menggunakan
artefak yang sama daripada job verify, tanpa membina semula template.

Persediaan pemilik sekali sahaja:
1. Cipta GitHub Environment `npm`; tetapkan reviewer jika dikehendaki.
2. Dalam npmjs.com > lokalchat > Settings > Trusted Publisher, pilih GitHub Actions:
   owner `jogetparguy-byte`, repo `lokalchat-open`, workflow `npm-release.yml`, environment `npm`.
   Benarkan direct publish (`npm publish`). Tiada token npm jangka panjang diperlukan.
3. Merge branch integrasi selepas CI lulus. Semak commit dan versi installer sebelum
   mencipta tag `v0.2.1` pada commit yang telah disemak dan push tag itu.
4. Tunggu workflow; semak integrity/latest dan jalankan pemasangan sebenar daripada registry.

Versi 0.2.1 ialah calon seterusnya, bukan bukti sudah diterbitkan. Source asal 0.2.0
ialah snapshot lokal; commit GitHub baharu tidak boleh dianggap sama dengan tarball lama.
Scaffold sedia ada tidak dikemas kini secara automatik. Migration baharu mesti turut
diaplikasikan bagi aplikasi pengguna sedia ada. Ujian CI ini tidak menjalankan Docker,
WhatsApp sebenar atau AI berbayar.
