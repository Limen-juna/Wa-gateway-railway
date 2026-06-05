# Deploy ke Railway dari HP Android

## Yang dibutuhkan
- Akun GitHub (gratis) → github.com
- Akun Railway (gratis) → railway.app
- Aplikasi GitHub di HP Android (opsional, bisa lewat browser)

---

## Langkah 1 — Upload ke GitHub

1. Buka **github.com** di browser HP kamu
2. Login → klik **+** → **New repository**
3. Nama repo: `baileys-nota-service` → **Create repository**
4. Klik **uploading an existing file**
5. Upload semua file berikut satu per satu:
   - `index.js`
   - `package.json`
   - `Dockerfile`
   - `railway.toml`
6. Klik **Commit changes**

---

## Langkah 2 — Deploy ke Railway

1. Buka **railway.app** di browser HP
2. Login dengan akun GitHub
3. Klik **New Project** → **Deploy from GitHub repo**
4. Pilih repo `baileys-nota-service`
5. Railway otomatis build & deploy (tunggu ~3 menit)

### Set Environment Variables di Railway:
Masuk ke project → tab **Variables** → tambahkan:

| Key | Value |
|-----|-------|
| `PORT` | `3001` |
| `ADMIN_NOMOR` | `6283848133796` |
| `WA_CREDS_JSON` | *(kosongkan dulu, isi setelah scan QR)* |

6. Klik tab **Settings** → **Networking** → **Generate Domain**
   Catat URL-nya, contoh: `https://baileys-nota-service-production.up.railway.app`

---

## Langkah 3 — Scan QR dari HP Android

1. Buka URL Railway kamu + `/qr`:
   ```
   https://baileys-nota-service-production.up.railway.app/qr
   ```
2. QR code akan muncul di browser
3. Buka **WhatsApp** → **Menu (⋮)** → **Perangkat Tertaut** → **Tautkan Perangkat**
4. Scan QR dari browser HP

Setelah berhasil, kamu akan dapat pesan WA konfirmasi di nomor `083848133796`.

---

## Langkah 4 — Simpan Sesi (PENTING!)

Setelah scan QR berhasil, Railway akan mencetak `creds.json` di log.

1. Railway → tab **Deployments** → klik deployment aktif → **View Logs**
2. Cari blok teks panjang di antara garis `═══...`
3. Salin semua teks JSON tersebut
4. Paste ke **Variables** → `WA_CREDS_JSON` → Save
5. Klik **Redeploy**

Sekarang sesi tersimpan permanen — tidak perlu scan ulang meski Railway restart.

---

## Langkah 5 — Update Workflow n8n Cloud

1. Buka n8n Cloud kamu
2. Import ulang workflow JSON (dari file `nota-whatsapp-n8n-workflow.json`)
3. Pada semua node yang punya URL `http://localhost:3001`, ganti dengan URL Railway:
   ```
   https://baileys-nota-service-production.up.railway.app
   ```
4. Simpan & aktifkan workflow

---

## Cek Status

```
GET https://<url-railway>/status
```

Response jika sudah terhubung:
```json
{ "connected": true, "akun": "6283848133796@s.whatsapp.net" }
```

---

## Biaya Railway

Plan **Hobby** Railway: **$5/bulan** (bisa pakai kartu kredit/debit).
Ada **trial gratis $5** saat pertama daftar — cukup untuk ~1 bulan pertama gratis.

Alternatif gratis 100%: **Render.com** (free tier, tapi sleep setelah 15 menit tidak aktif).
