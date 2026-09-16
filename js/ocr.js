/**
 * AI Grading – multi-model fallback (Gemini free tier sering 404 / rate limit)
 * Alur: gradeWithAI() kirim soal+lembar sekaligus seperti chat ke guru
 */

const GEMINI_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-flash-latest',
  'gemini-flash-latest'
];

function geminiUrl(model) {
  return 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent';
}

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
  if (!text || typeof text !== 'string') {
    return { error: 'Respons AI kosong', raw_text: text };
  }
  let t = text.trim();
  // Buang markdown code fence
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  // Coba parse langsung
  try { return JSON.parse(t); } catch (_) {}
  // Ambil objek JSON terpanjang
  const matches = t.match(/\{[\s\S]*\}/g);
  if (matches) {
    const sorted = matches.slice().sort((a, b) => b.length - a.length);
    for (const m of sorted) {
      try { return JSON.parse(m); } catch (_) {}
      // Perbaiki trailing comma kasar
      try {
        const fixed = m.replace(/,\s*([}\]])/g, '$1');
        return JSON.parse(fixed);
      } catch (_) {}
    }
  }
  // Cari dari { pertama sampai } terakhir
  const i = t.indexOf('{');
  const j = t.lastIndexOf('}');
  if (i >= 0 && j > i) {
    const slice = t.slice(i, j + 1);
    try { return JSON.parse(slice); } catch (_) {}
    try { return JSON.parse(slice.replace(/,\s*([}\]])/g, '$1')); } catch (_) {}
  }
  console.warn('JSON parse gagal, cuplikan:', t.slice(0, 400));
  return { raw_text: t, error: 'Gagal parse JSON dari AI' };
}

async function callGemini(apiKey, body) {
  let lastErr = null;
  for (const model of GEMINI_MODELS) {
    try {
      const res = await fetch(geminiUrl(model) + '?key=' + apiKey, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.status === 404 || res.status === 429) {
        const t = await res.text();
        lastErr = new Error('Model ' + model + ' → ' + res.status + ': ' + t.slice(0, 180));
        console.warn(lastErr.message);
        continue;
      }
      if (!res.ok) {
        const t = await res.text();
        lastErr = new Error('Gemini ' + res.status + ': ' + t.slice(0, 250));
        // 400 sering model-specific, coba model lain
        if (res.status === 400 || res.status === 503) continue;
        throw lastErr;
      }
      const data = await res.json();
      data._usedModel = model;
      return data;
    } catch (e) {
      lastErr = e;
      console.warn('Gemini model fail', model, e.message);
    }
  }
  throw lastErr || new Error('Semua model Gemini gagal. Coba lagi beberapa menit (kuota gratis peak).');
}

/**
 * Nilai seperti chat manual ke AI
 */
export async function gradeWithAI(keyFiles, studentFiles, apiKey, options = {}) {
  if (!apiKey) throw new Error('Gemini API Key belum diisi');
  if (!studentFiles || !studentFiles.length) throw new Error('Tidak ada lembar siswa');

  const parts = [];
  const prompt = `Kamu adalah guru penguji yang sangat teliti. Nilai lembar jawaban siswa berdasarkan file soal/kunci.

CARA KERJA:
1. Baca SOAL/KUNCI yang diberikan.
2. Baca LEMBAR JAWABAN SISWA.
3. Ekstrak meta: nama, sekolah, kelas, tanggal, mapel.
4. PG: tentukan kunci (dari file atau pengetahuanmu), bandingkan jawaban siswa.
5. ESSAY: nilai 0-100 per soal berdasarkan ketepatan & kelengkapan; kunci bisa disesuaikan mendekati jawaban siswa yang benar secara konsep.
6. Nilai akhir skala 0-100.

Jika file "kunci" ternyata LEMBAR SOAL, pakai pengetahuan guru + isi soal.

Keluarkan HANYA JSON valid:

{
  "meta": { "sekolah": "", "kelas": "", "tanggal": "", "mapel": "", "catatan": "" },
  "siswa": [
    {
      "nama": "",
      "kelas": "",
      "file": "",
      "score": 80,
      "pg": {
        "benar": 4,
        "total": 5,
        "persen": 80,
        "items": [
          {
            "nomor": 1,
            "soal": "redaksi soal singkat",
            "kunci": "A",
            "siswa": "A",
            "benar": true,
            "skor": 100,
            "catatan": ""
          }
        ]
      },
      "essay": {
        "skor_total": 70,
        "skor_maks": 100,
        "persen": 70,
        "items": [
          {
            "nomor": 1,
            "soal": "redaksi soal essay",
            "kunci": "kunci / kriteria yang disesuaikan",
            "siswa": "jawaban siswa",
            "benar": true,
            "skor": 80,
            "catatan": ""
          }
        ]
      },
      "details": []
    }
  ],
  "missing": [],
  "ringkasan": ""
}

Field details boleh diisi gabungan pg+essay untuk kompatibilitas, tapi prioritaskan struktur pg dan essay di atas.
${options.onlineKey ? 'Gunakan pengetahuanmu sebagai second opinion kunci.' : ''}
${options.extra || ''}

HANYA JSON.`;

  parts.push({ text: prompt });

  for (const f of (keyFiles || [])) {
    const { base64, mime, name } = await fileToBase64(f);
    parts.push({ text: '\n--- FILE KUNCI/SOAL: ' + name + ' ---\n' });
    parts.push({ inline_data: { mime_type: mime, data: base64 } });
  }
  for (const f of (studentFiles || [])) {
    const { base64, mime, name } = await fileToBase64(f);
    parts.push({ text: '\n--- FILE LEMBAR SISWA: ' + name + ' ---\n' });
    parts.push({ inline_data: { mime_type: mime, data: base64 } });
  }

  const body = {
    contents: [{ parts }],
    generationConfig: { temperature: 0.15, maxOutputTokens: 8192, responseMimeType: "application/json" }
  };

  const data = await callGemini(apiKey, body);
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const parsed = parseJsonFromText(text);
  parsed._usedModel = data._usedModel;

  // Normalisasi: kadang AI bungkus di "data" / "result"
  if (!parsed.siswa && parsed.data && parsed.data.siswa) Object.assign(parsed, parsed.data);
  if (!parsed.siswa && parsed.result && parsed.result.siswa) Object.assign(parsed, parsed.result);
  if (!parsed.siswa && Array.isArray(parsed.results)) parsed.siswa = parsed.results;
  if (!parsed.siswa && parsed.nama) parsed.siswa = [parsed]; // satu siswa di root

  if ((!parsed.siswa || !parsed.siswa.length) && parsed.error) {
    throw new Error('AI tidak mengembalikan hasil valid. Model: ' + (data._usedModel || '?') + '. Coba ulang. Detail: ' + String(parsed.error));
  }
  if (!parsed.siswa || !parsed.siswa.length) {
    console.warn('Raw AI text:', text.slice(0, 500));
    throw new Error('AI merespons tapi format tidak dikenali. Model: ' + (data._usedModel || '?') + '. Coba ulang (kadang peak Gemini).');
  }
  return parsed;
}

export async function ocrWithGemini(file, apiKey, promptExtra = '') {
  if (!apiKey) throw new Error('Gemini API Key belum diisi');
  const { base64, mime } = await fileToBase64(file);
  const prompt = 'Ekstrak JSON dari dokumen: {"nama":null,"sekolah":null,"kelas":null,"jawaban":[{"nomor":1,"jawaban":"..."}]}\n' + promptExtra + '\nHanya JSON.';
  const body = {
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: base64 } }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 4096 }
  };
  const data = await callGemini(apiKey, body);
  return parseJsonFromText(data?.candidates?.[0]?.content?.parts?.[0]?.text || '');
}

export async function processFile(file, geminiKey, preferGemini = true, context = 'auto') {
  try {
    if (preferGemini && geminiKey) {
      return await ocrWithGemini(file, geminiKey, context === 'key' ? 'kunci/soal' : 'lembar siswa');
    }
  } catch (e) {
    console.warn('OCR gagal', e.message);
  }
  return { nama: null, jawaban: [], error: 'OCR gagal', file: file.name };
}

export async function searchAnswerKeyOnline(questionText, geminiKey) {
  if (!geminiKey || !questionText) return null;
  try {
    const body = {
      contents: [{ parts: [{ text: 'Kunci singkat JSON {"jawaban":[{"nomor":1,"jawaban":"..."}]}\n' + questionText }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 2048 }
    };
    const data = await callGemini(geminiKey, body);
    return parseJsonFromText(data?.candidates?.[0]?.content?.parts?.[0]?.text || '');
  } catch (e) {
    return null;
  }
}
