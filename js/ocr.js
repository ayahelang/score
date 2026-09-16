/**
 * OCR helpers – Gemini Vision (primary) + Tesseract.js (fallback)
 */

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

export async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      const base64 = result.split(',')[1];
      resolve({ base64, mime: file.type || 'image/jpeg' });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function ocrWithGemini(file, apiKey, promptExtra = '', context = 'auto') {
  if (!apiKey) throw new Error('Gemini API Key belum diisi');

  const { base64, mime } = await fileToBase64(file);

  const prompt = `Kamu adalah sistem OCR + analisis dokumen pendidikan yang sangat ahli membaca TULISAN TANGAN (bahasa Indonesia, Arab, Inggris, dan campuran).

Dokumen bisa berupa foto lembar jawaban siswa, kunci jawaban, modul ajar, atau LJK. Tulisan sering tidak rapi, miring, atau berbahasa Arab.

Analisis gambar/dokumen ini dan keluarkan HANYA JSON valid (tanpa markdown, tanpa teks di luar JSON).

Struktur JSON yang WAJIB diikuti:
{
  "dokumen_tipe": "lembar_siswa" | "kunci_jawaban" | "modul_ajar" | "lembar_sudah_dinilai" | "lainnya",
  "kepercayaan_kunci": 0-100,
  "nama": "nama siswa jika ada (boleh Arab/Latin), null jika tidak",
  "sekolah": "nama sekolah jika terbaca, null jika tidak",
  "kelas": "kelas jika ada, null jika tidak",
  "tanggal": "tanggal ujian jika ada (format bebas), null jika tidak",
  "mapel": "mata pelajaran / ruang jika ada, null jika tidak",
  "nomor_absen": "jika ada",
  "tipe_soal": "pg" | "essay" | "campuran",
  "jawaban": [
    { "nomor": 1, "jawaban": "teks jawaban apa adanya (Arab/Latin/angka/huruf)", "benar": true/false/null }
  ],
  "teks_soal": "redaksi soal jika terbaca (boleh ringkas)",
  "nilai_tertera": "nilai yang sudah ditulis guru (jika lembar sudah dinilai), null jika tidak",
  "catatan": "info penting lain (bahasa dominan, kualitas tulisan, dll)"
}

ATURAN PENTING:
1. Baca tulisan tangan sebaik mungkin. Jangan mengarang jawaban yang tidak terbaca.
2. Jika teks berbahasa Arab, transkripsikan tetap dalam Arab (jangan diterjemahkan).
3. Jika LEMBAR JAWABAN SISWA YANG SUDAH DINILAI (ada nilai besar dilingkari, coretan guru, tapi TIDAK ada tanda ✓/✗ atau kunci jelas per nomor) → dokumen_tipe = "lembar_sudah_dinilai", kepercayaan_kunci = 20-40. JANGAN anggap 100% sebagai kunci.
4. Jika MODUL AJAR / kunci jawaban jelas → dokumen_tipe = "modul_ajar" atau "kunci_jawaban", kepercayaan_kunci = 90-100.
5. Jika KUNCI JAWABAN murni → kepercayaan_kunci = 85-100.
6. Jika LEMBAR SISWA belum dinilai → dokumen_tipe = "lembar_siswa", kepercayaan_kunci = 0.
7. Ekstrak meta (sekolah, kelas, tanggal, mapel, nama) sejauh yang terbaca.

${promptExtra}

Keluarkan HANYA JSON.`;

  const body = {
    contents: [{
      parts: [
        { text: prompt },
        {
          inline_data: {
            mime_type: mime,
            data: base64
          }
        }
      ]
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 8192
    }
  };

  const res = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return parseJsonFromText(text);
}

export async function ocrWithTesseract(file, lang = 'ind+eng') {
  const worker = await Tesseract.createWorker(lang);
  const { data: { text } } = await worker.recognize(file);
  await worker.terminate();
  return {
    raw_text: text,
    nama: extractNameHeuristic(text),
    jawaban: extractAnswersHeuristic(text)
  };
}

function parseJsonFromText(text) {
  // Coba ekstrak JSON dari response
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch (e) {
      console.warn('JSON parse fail', e);
    }
  }
  return { raw_text: text, jawaban: [] };
}

function extractNameHeuristic(text) {
  const m = text.match(/(?:nama|name)\s*[:\-]\s*(.+)/i);
  return m ? m[1].trim().split('\n')[0] : null;
}

function extractAnswersHeuristic(text) {
  const lines = text.split('\n');
  const answers = [];
  for (const line of lines) {
    const m = line.match(/(\d+)\s*[\.\)\:\-]\s*([A-Ea-e].*)/);
    if (m) {
      answers.push({ nomor: parseInt(m[1], 10), jawaban: m[2].trim() });
    }
  }
  return answers;
}

/**
 * Proses file (image / pdf page) → OCR result
 * context: 'key' | 'student' | 'auto'
 */
export async function processFile(file, geminiKey, preferGemini = true, context = 'auto') {
  const isImage = file.type.startsWith('image/');
  if (!isImage && !file.type.includes('pdf')) {
    return { error: 'Tipe file tidak didukung untuk OCR langsung', file: file.name };
  }

  try {
    if (preferGemini && geminiKey) {
      const extra = context === 'key'
        ? 'Dokumen ini diupload sebagai KUNCI JAWABAN / referensi. Analisis apakah ini kunci murni, modul ajar, atau lembar siswa yang sudah dinilai.'
        : context === 'student'
        ? 'Dokumen ini diupload sebagai LEMBAR JAWABAN SISWA. Prioritaskan ekstrak nama siswa + jawaban per nomor.'
        : '';
      return await ocrWithGemini(file, geminiKey, extra, context);
    }
  } catch (e) {
    console.warn('Gemini gagal, fallback Tesseract', e.message);
  }

  try {
    return await ocrWithTesseract(file);
  } catch (e) {
    return { error: e.message, file: file.name };
  }
}

/**
 * Cari kunci jawaban online (second opinion) – sederhana via Gemini
 */
export async function searchAnswerKeyOnline(questionText, geminiKey) {
  if (!geminiKey || !questionText) return null;

  const prompt = `Berikan jawaban yang paling tepat untuk soal berikut (bisa PG atau essay singkat).
Jawab dalam format JSON: { "jawaban": "...", "penjelasan": "singkat" }

Soal:
${questionText}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 1024 }
  };

  const res = await fetch(`${GEMINI_ENDPOINT}?key=${geminiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) return null;
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return parseJsonFromText(text);
}
