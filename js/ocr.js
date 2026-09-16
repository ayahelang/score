/**
 * OCR + AI Grading helpers
 * Alur utama: gradeWithAI() – seperti chat manual ke guru AI
 * (kirim soal/kunci + lembar siswa sekaligus → dapat nilai + detail)
 */

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

export async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      const base64 = result.split(',')[1];
      let mime = file.type || 'image/jpeg';
      if (file.name.toLowerCase().endsWith('.pdf')) mime = 'application/pdf';
      resolve({ base64, mime, name: file.name });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function parseJsonFromText(text) {
  const match = text && text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch (e) {
      console.warn('JSON parse fail', e);
    }
  }
  return { raw_text: text, error: 'Gagal parse JSON dari AI' };
}

/**
 * INTI: Nilai seperti chat manual ke AI
 * Kirim semua file soal/kunci + lembar siswa dalam 1 request multimodal.
 */
export async function gradeWithAI(keyFiles, studentFiles, apiKey, options = {}) {
  if (!apiKey) throw new Error('Gemini API Key belum diisi');
  if (!studentFiles || !studentFiles.length) throw new Error('Tidak ada lembar siswa');

  const parts = [];

  const prompt = `Kamu adalah guru penguji yang sangat teliti. Tugasmu: menilai lembar jawaban siswa berdasarkan file soal / kunci yang diberikan.

CARA KERJA (sama seperti guru manusia):
1. Baca file SOAL / KUNCI JAWABAN yang diberikan.
2. Baca file LEMBAR JAWABAN SISWA.
3. Ekstrak data meta: nama siswa, sekolah, kelas, tanggal, mapel.
4. Untuk PILIHAN GANDA: tentukan jawaban benar (dari kunci jika ada, atau dari pengetahuanmu + isi soal), bandingkan dengan jawaban siswa.
5. Untuk ESSAY: nilai berdasarkan kelengkapan, ketepatan konsep, dan kejelasan (proporsional).
6. Hitung nilai akhir 0-100.

Jika yang diupload sebagai "kunci" ternyata adalah LEMBAR SOAL (bukan kunci jawaban), gunakan pengetahuanmu sebagai guru + isi soal untuk menentukan jawaban yang benar, lalu nilai lembar siswa.

Keluarkan HANYA JSON valid (tanpa markdown) dengan struktur:

{
  "meta": {
    "sekolah": "...",
    "kelas": "...",
    "tanggal": "...",
    "mapel": "...",
    "catatan": "opsional"
  },
  "siswa": [
    {
      "nama": "nama siswa dari lembar",
      "kelas": "kelas jika ada",
      "file": "nama file jika diketahui",
      "score": 75,
      "correct": 4,
      "total": 8,
      "details": [
        {
          "nomor": "1",
          "tipe": "pg",
          "siswa": "jawaban siswa",
          "kunci": "jawaban benar",
          "benar": true,
          "skor_butir": 100,
          "catatan": "opsional"
        }
      ]
    }
  ],
  "missing": ["daftar data yang dicari tapi tidak ditemukan"],
  "ringkasan": "1-2 kalimat ringkasan penilaian"
}

${options.onlineKey ? 'Gunakan juga pengetahuanmu sebagai second opinion untuk kunci jawaban.' : ''}
${options.extra || ''}

HANYA JSON.`;

  parts.push({ text: prompt });

  for (const f of (keyFiles || [])) {
    const { base64, mime, name } = await fileToBase64(f);
    parts.push({ text: '\\n--- FILE KUNCI/SOAL: ' + name + ' ---\\n' });
    parts.push({ inline_data: { mime_type: mime, data: base64 } });
  }

  for (const f of (studentFiles || [])) {
    const { base64, mime, name } = await fileToBase64(f);
    parts.push({ text: '\\n--- FILE LEMBAR SISWA: ' + name + ' ---\\n' });
    parts.push({ inline_data: { mime_type: mime, data: base64 } });
  }

  const body = {
    contents: [{ parts }],
    generationConfig: {
      temperature: 0.15,
      maxOutputTokens: 8192
    }
  };

  const res = await fetch(GEMINI_ENDPOINT + '?key=' + apiKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error('Gemini error ' + res.status + ': ' + err.slice(0, 300));
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const parsed = parseJsonFromText(text);

  if (parsed.error && !parsed.siswa) {
    throw new Error('AI tidak mengembalikan hasil penilaian yang valid. Coba lagi atau periksa file.');
  }

  return parsed;
}

export async function ocrWithGemini(file, apiKey, promptExtra = '') {
  if (!apiKey) throw new Error('Gemini API Key belum diisi');
  const { base64, mime } = await fileToBase64(file);

  const prompt = 'Ekstrak data dari dokumen pendidikan ini sebagai JSON:\\n' +
    '{"nama":null,"sekolah":null,"kelas":null,"tanggal":null,"mapel":null,' +
    '"jawaban":[{"nomor":1,"jawaban":"..."}],"dokumen_tipe":"lembar_siswa","kepercayaan_kunci":0}\\n' +
    promptExtra + '\\nHanya JSON.';

  const body = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mime, data: base64 } }
      ]
    }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 4096 }
  };

  const res = await fetch(GEMINI_ENDPOINT + '?key=' + apiKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('Gemini ' + res.status);
  const data = await res.json();
  return parseJsonFromText(data?.candidates?.[0]?.content?.parts?.[0]?.text || '');
}

export async function processFile(file, geminiKey, preferGemini = true, context = 'auto') {
  try {
    if (preferGemini && geminiKey) {
      return await ocrWithGemini(file, geminiKey, context === 'key' ? 'Ini file kunci/soal.' : 'Ini lembar siswa.');
    }
  } catch (e) {
    console.warn('OCR gagal', e.message);
  }
  return { nama: null, jawaban: [], error: 'OCR gagal', file: file.name };
}

export async function searchAnswerKeyOnline(questionText, geminiKey) {
  if (!geminiKey || !questionText) return null;
  const body = {
    contents: [{ parts: [{ text: 'Berikan kunci jawaban singkat untuk:\\n' + questionText + '\\nJSON: {"jawaban":[{"nomor":1,"jawaban":"..."}]}' }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 2048 }
  };
  const res = await fetch(GEMINI_ENDPOINT + '?key=' + geminiKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) return null;
  const data = await res.json();
  return parseJsonFromText(data?.candidates?.[0]?.content?.parts?.[0]?.text || '');
}
