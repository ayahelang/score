/**
 * AI Grading – batch per file + Edge Function (API key di server)
 * Fallback: client Gemini multi-model jika edge belum di-deploy & ada temporary key
 */

import { gradeEndpoint, APP_CONFIG } from './config.js';

const GEMINI_MODELS = [
  'gemini-3.6-flash',
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

export function parseJsonFromText(text) {
  if (!text || typeof text !== 'string') {
    return { error: 'Respons AI kosong', raw_text: text };
  }
  let t = text.trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(t); } catch (_) {}
  const matches = t.match(/\{[\s\S]*\}/g);
  if (matches) {
    const sorted = matches.slice().sort((a, b) => b.length - a.length);
    for (const m of sorted) {
      try { return JSON.parse(m); } catch (_) {}
      try { return JSON.parse(m.replace(/,\s*([}\]])/g, '$1')); } catch (_) {}
    }
  }
  const i = t.indexOf('{');
  const j = t.lastIndexOf('}');
  if (i >= 0 && j > i) {
    const slice = t.slice(i, j + 1);
    try { return JSON.parse(slice); } catch (_) {}
    try { return JSON.parse(slice.replace(/,\s*([}\]])/g, '$1')); } catch (_) {}
  }
  console.warn('JSON parse gagal:', t.slice(0, 400));
  return { raw_text: t, error: 'Gagal parse JSON dari AI' };
}

async function callGeminiClient(apiKey, body) {
  let lastErr = null;
  for (const model of GEMINI_MODELS) {
    try {
      const res = await fetch(geminiUrl(model) + '?key=' + apiKey, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.status === 404 || res.status === 429) {
        lastErr = new Error(model + ' ' + res.status);
        continue;
      }
      if (!res.ok) {
        const t = await res.text();
        lastErr = new Error('Gemini ' + res.status + ': ' + t.slice(0, 200));
        if (res.status === 400 || res.status === 503) continue;
        throw lastErr;
      }
      const data = await res.json();
      data._usedModel = model;
      return data;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('Semua model Gemini gagal');
}

function buildGradePrompt(options = {}) {
  return `Kamu guru penguji teliti. Nilai lembar siswa berdasarkan soal/kunci.
Balas HANYA JSON (tanpa markdown):
{"meta":{"sekolah":"","kelas":"","tanggal":"","mapel":""},"siswa":[{"nama":"","kelas":"","file":"","score":0,"pg":{"benar":0,"total":0,"persen":0,"items":[{"nomor":1,"soal":"","kunci":"","siswa":"","benar":true,"skor":100}]},"essay":{"skor_total":0,"skor_maks":100,"persen":0,"items":[{"nomor":1,"soal":"","kunci":"","siswa":"","benar":true,"skor":80}]}}],"missing":[],"ringkasan":""}
Jika file kunci adalah soal, pakai pengetahuan guru + isi soal.
${options.onlineKey ? 'Second opinion dari pengetahuanmu diizinkan.' : ''}
${options.extra || ''}`;
}

/**
 * Satu batch: kunci + 1..N lembar siswa (disarankan 1 siswa per batch agar JSON stabil)
 */
export async function gradeBatch(keyFiles, studentFiles, options = {}) {
  const keys = [];
  for (const f of keyFiles || []) keys.push(await fileToBase64(f));
  const students = [];
  for (const f of studentFiles || []) students.push(await fileToBase64(f));

  // 1) Coba Edge Function (API key di server — tidak perlu localStorage)
  try {
    const res = await fetch(gradeEndpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + APP_CONFIG.supabaseAnonKey,
        'apikey': APP_CONFIG.supabaseAnonKey
      },
      body: JSON.stringify({ keys, students, onlineKey: !!options.onlineKey })
    });
    if (res.ok) {
      const parsed = await res.json();
      if (parsed.siswa) return parsed;
      if (parsed.error) console.warn('Edge grade:', parsed.error, parsed.raw);
    } else {
      const errText = await res.text();
      console.warn('Edge function status', res.status, errText.slice(0, 200));
      // 404 = belum di-deploy → fallback client
    }
  } catch (e) {
    console.warn('Edge function unreachable', e.message);
  }

  // 2) Fallback client (hanya jika options.apiKey ada — admin/dev)
  if (!options.apiKey) {
    throw new Error(
      'Server penilaian belum siap. Admin: deploy Edge Function "grade" & set secret GEMINI_API_KEY di Supabase. ' +
      'Lihat supabase/functions/grade/ dan README.'
    );
  }

  const parts = [{ text: buildGradePrompt(options) }];
  for (const f of keys) {
    parts.push({ text: '\n--- KUNCI/SOAL: ' + f.name + ' ---\n' });
    parts.push({ inline_data: { mime_type: f.mime, data: f.base64 } });
  }
  for (const f of students) {
    parts.push({ text: '\n--- LEMBAR SISWA: ' + f.name + ' ---\n' });
    parts.push({ inline_data: { mime_type: f.mime, data: f.base64 } });
  }

  const body = {
    contents: [{ parts }],
    generationConfig: { temperature: 0.15, maxOutputTokens: 8192, responseMimeType: 'application/json' }
  };

  const data = await callGeminiClient(options.apiKey, body);
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const parsed = parseJsonFromText(text);
  parsed._usedModel = data._usedModel;
  if (!parsed.siswa && parsed.data?.siswa) Object.assign(parsed, parsed.data);
  if (!parsed.siswa || !parsed.siswa.length) {
    throw new Error('AI merespons tapi JSON tidak valid (batch). Model: ' + (data._usedModel || '?') + '. Coba ulang.');
  }
  return parsed;
}

/** Kompatibilitas: semua file sekaligus */
export async function gradeWithAI(keyFiles, studentFiles, apiKey, options = {}) {
  return gradeBatch(keyFiles, studentFiles, { ...options, apiKey });
}

export async function processFile() {
  return { nama: null, jawaban: [], error: 'deprecated' };
}

export async function searchAnswerKeyOnline() {
  return null;
}
