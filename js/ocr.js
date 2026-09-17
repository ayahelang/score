/**
 * AI Grading – compress images + batch + Edge Function
 * Mendukung multi-bahasa, tulisan tangan, foto miring/portrait/landscape
 */

import { gradeEndpoint, APP_CONFIG } from './config.js';

const MAX_EDGE = 1280; // px sisi terpanjang
const JPEG_Q = 0.72;

export async function fileToBase64(file, compress = true) {
  const name = file.name || 'file';
  const isPdf = name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
  if (isPdf || !compress) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(',')[1];
        const mime = isPdf ? 'application/pdf' : (file.type || 'image/jpeg');
        resolve({ base64, mime, name });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  // Kompres gambar (orientasi EXIF diabaikan browser canvas – tetap kirim)
  try {
    const bitmap = await createImageBitmap(file);
    let w = bitmap.width, h = bitmap.height;
    const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
    w = Math.round(w * scale);
    h = Math.round(h * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_Q);
    return { base64: dataUrl.split(',')[1], mime: 'image/jpeg', name };
  } catch (e) {
    console.warn('compress fail, raw', e);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({
        base64: reader.result.split(',')[1],
        mime: file.type || 'image/jpeg',
        name
      });
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
}

export function parseJsonFromText(text) {
  if (!text || typeof text !== 'string') return { error: 'Respons AI kosong', raw_text: text };
  let t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(t); } catch (_) {}
  const matches = t.match(/\{[\s\S]*\}/g);
  if (matches) {
    for (const m of matches.slice().sort((a, b) => b.length - a.length)) {
      try { return JSON.parse(m); } catch (_) {}
      try { return JSON.parse(m.replace(/,\s*([}\]])/g, '$1')); } catch (_) {}
    }
  }
  const i = t.indexOf('{'), j = t.lastIndexOf('}');
  if (i >= 0 && j > i) {
    try { return JSON.parse(t.slice(i, j + 1)); } catch (_) {}
  }
  return { raw_text: t, error: 'Gagal parse JSON dari AI' };
}

function buildPrompt(options = {}) {
  return `Kamu guru profesional multi-bahasa (dunia + bahasa daerah). Nilai lembar siswa.

KEMAMPUAN WAJIB:
- Baca cetakan printer DAN tulisan tangan (termasuk miring, buram, portrait/landscape).
- Bahasa apa pun: Arab, Inggris, Indonesia, daerah, dll. Transkrip apa adanya, jangan terjemahkan kecuali perlu penilaian.
- Jika foto tidak terbaca / rusak / terlalu buram: set nama="Tidak terbaca", score=0, catatan jelaskan, missing tambah "file tidak terbaca: <nama>".

JSON HANYA:
{"meta":{"sekolah":"","kelas":"","tanggal":"","mapel":""},"siswa":[{"nama":"","kelas":"","file":"","score":0,"pg":{"benar":0,"total":0,"persen":0,"items":[{"nomor":1,"soal":"","kunci":"","siswa":"","benar":true,"skor":100}]},"essay":{"skor_total":0,"skor_maks":100,"persen":0,"items":[{"nomor":1,"soal":"","kunci":"","siswa":"","benar":true,"skor":80}]},"catatan":""}],"missing":[],"ringkasan":""}
Jika kunci = lembar soal, pakai pengetahuan guru.
${options.onlineKey ? 'Second opinion pengetahuan diizinkan.' : ''}
${options.extra || ''}`;
}

/**
 * Satu batch: boleh beberapa kunci + 1 siswa (disarankan)
 * Kunci banyak → dipotong otomatis max 4 per request, digabung
 */
export async function gradeBatch(keyFiles, studentFiles, options = {}) {
  const students = [];
  for (const f of studentFiles || []) {
    students.push(await fileToBase64(f, true));
  }
  if (!students.length) throw new Error('Tidak ada lembar siswa');

  // Kunci: kompres, max 4 file per request edge (hindari body terlalu besar)
  const allKeys = [];
  for (const f of keyFiles || []) allKeys.push(await fileToBase64(f, true));

  const keyChunks = [];
  if (allKeys.length === 0) keyChunks.push([]);
  else {
    for (let i = 0; i < allKeys.length; i += 4) keyChunks.push(allKeys.slice(i, i + 4));
  }

  let merged = null;
  for (let c = 0; c < keyChunks.length; c++) {
    const keys = keyChunks[c];
    const payload = {
      keys,
      students: c === 0 ? students : students, // siswa selalu ikut
      onlineKey: !!options.onlineKey
    };

    const result = await callGradeAPI(payload, options);
    if (!merged) merged = result;
    else {
      // Gabungkan detail jika beberapa chunk kunci
      if (result.siswa && merged.siswa) {
        // prioritaskan hasil chunk pertama; tambah missing
        merged.missing = [...new Set([...(merged.missing || []), ...(result.missing || [])])];
      }
    }
  }
  return merged;
}

async function callGradeAPI(payload, options = {}) {
  let lastDetail = '';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000); // 2 menit
    const res = await fetch(gradeEndpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + APP_CONFIG.supabaseAnonKey,
        'apikey': APP_CONFIG.supabaseAnonKey
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timer);

    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}

    if (res.ok && json && (json.siswa || json.meta)) {
      return json;
    }
    lastDetail = json?.error || text.slice(0, 300) || ('HTTP ' + res.status);
    console.warn('Edge grade fail', res.status, lastDetail);
  } catch (e) {
    lastDetail = e.name === 'AbortError' ? 'Timeout (>2 menit)' : e.message;
    console.warn('Edge unreachable', lastDetail);
  }

  throw new Error(
    'Gagal memanggil server penilaian: ' + lastDetail +
    ' | Pastikan function grade Active + secret GEMINI_API_KEY. ' +
    'File terlalu banyak/berat? Coba kurangi halaman kunci per batch.'
  );
}

export async function gradeWithAI(keyFiles, studentFiles, apiKey, options = {}) {
  return gradeBatch(keyFiles, studentFiles, { ...options, apiKey });
}

export async function processFile() {
  return { nama: null, jawaban: [], error: 'deprecated' };
}

export async function searchAnswerKeyOnline() {
  return null;
}
