# Silverhawk Scoring

**AI-Powered Answer Sheet Checker**  
Bagian dari [silverhawk.web.id](https://silverhawk.web.id) → subdomain target: `https://score.silverhawk.web.id`

Aplikasi web modern untuk memeriksa lembar jawaban siswa (PG, Essay, LJK, tulisan tangan) menggunakan OCR AI + scoring otomatis.

## Fitur Utama (MVP siap pakai)

- Upload kunci jawaban (multi foto / PDF / ZIP)
- Upload lembar siswa (multi / ZIP)
- Checkbox “Cari kunci online” (second opinion AI)
- OCR pintar: **Google Gemini Vision** (utama) + Tesseract.js (fallback)
- Progress bar + elapsed time
- Hasil list nama + nilai → klik expand lihat detail per soal
- Export PDF & Excel
- Analisis butir soal (tingkat kesukaran)
- Login Google (opsional via Supabase)
- Design modern minimalis dark/light, fully responsive
- Favicon sudah ada

## Cara Deploy Cepat ke GitHub Pages

1. Buat repository baru di GitHub (public).
2. Upload **semua isi folder ini** (bukan foldernya) ke root repo.
3. Settings → Pages → Source: Deploy from branch `main` / `root`.
4. Tunggu 1–2 menit → akses `https://username.github.io/repo-name`.
5. Nanti arahkan custom domain / subdomain `score.silverhawk.web.id` ke GitHub Pages.

## Setup Supabase (Gratis)

1. Buat akun di [supabase.com](https://supabase.com) → New Project.
2. Tunggu project ready.
3. **SQL Editor** → jalankan isi file `supabase/schema.sql`.
4. **Authentication → Providers** → aktifkan **Google**.
   - Buat OAuth Client di Google Cloud Console (Web application).
   - Authorized redirect URIs: `https://xxxx.supabase.co/auth/v1/callback`
   - Masukkan Client ID & Secret ke Supabase.
5. **Storage** → buat 2 bucket: `answer-keys` dan `student-sheets` (bisa public atau private).
6. **Project Settings → API** → salin:
   - Project URL
   - `anon` `public` key
7. Buka aplikasi → muncul modal Setup → isi URL + Anon Key.

## Setup Gemini API Key (Gratis)

1. Buka [Google AI Studio](https://aistudio.google.com/) → Get API Key.
2. Buat key baru (free tier cukup generus).
3. Masukkan di modal Setup aplikasi (disimpan di localStorage browser).

> **Penting**: Jangan commit API key ke GitHub. Key hanya disimpan di browser user.

## Struktur File

```
silverhawk-scoring/
├── index.html
├── css/style.css
├── js/
│   ├── app.js          ← main logic
│   ├── supabase.js
│   ├── ocr.js          ← Gemini + Tesseract
│   ├── scoring.js
│   ├── export.js
│   └── utils.js
├── assets/favicon.svg
├── supabase/schema.sql
└── README.md
```

## Cara Pakai

1. Buka web → isi config (atau lewati untuk demo).
2. Upload foto/PDF/ZIP **kunci jawaban**.
3. Upload foto/PDF/ZIP **lembar siswa**.
4. (Opsional) isi info sekolah/kelas/tanggal.
5. Centang “Cari kunci online” jika ingin second opinion AI.
6. Klik **MULAI PENILAIAN**.
7. Tunggu progress → lihat hasil → export PDF/Excel → analisis butir.

## Auto-Clean & Subscriber

- Data upload + hasil otomatis bisa dibersihkan setelah 7 hari (Edge Function + cron).
- User yang login Google + masukkan kode voucher (request ke WA +6285159922358) → `is_subscriber = true` → data tidak dihapus.

Implementasi Edge Function cleanup ada di komentar `schema.sql`.

## Batasan Free Tier

- Gemini free: rate limit (cukup untuk puluhan–ratusan lembar/hari).
- Supabase free: 500 MB DB + 1 GB Storage → auto-clean penting.
- GitHub Pages: static only (semua AI call dari browser).

## Pengembangan Lanjutan (opsional)

- Edge Function untuk proses OCR di server (lebih aman key).
- Multi-page PDF full rendering dengan pdf.js.
- Dashboard admin untuk manage voucher & clean database.
- Realtime progress via Supabase channel.
- Support LJK bubble detection lebih akurat (template matching).

## Branding

- Nama: **Silverhawk Scoring**
- Warna: dark `#0f0f12`, silver `#c0c0c0`, accent cyan `#00d4ff`
- Favicon sementara sudah disediakan (bisa diganti kapan saja).

---

Dibuat untuk Teddy Mulyana / Silverhawk Network  
IT Coordinator • Depok, West Java

Pertanyaan teknis? Hubungi via portal [silverhawk.web.id](https://silverhawk.web.id)

## Deploy Edge Function (wajib untuk penilaian AI)

API key Gemini **tidak** disimpan di browser. Simpan di Supabase:

```bash
# Install CLI: https://supabase.com/docs/guides/cli
supabase login
supabase link --project-ref lvvphyyoqekudwnffiyj
supabase secrets set GEMINI_API_KEY=AIza_your_key_here
supabase functions deploy grade
```

Atau di Dashboard: **Edge Functions** → create `grade` → paste isi `supabase/functions/grade/index.ts` → Secrets → `GEMINI_API_KEY`.

Setelah deploy, URL: `https://lvvphyyoqekudwnffiyj.supabase.co/functions/v1/grade`

## Batch penilaian

Setiap lembar siswa diproses terpisah (bersama file kunci) agar respons AI tidak putus/JSON rusak.
Progress menampilkan nama file yang sedang digarap.
