/**
 * AI Grading – 2 fase (ekstrak kunci → nilai per siswa)
 * Kompres agresif + orientasi foto + custom prompt
 */

import { gradeEndpoint, APP_CONFIG } from './config.js';

const MAX_EDGE = 900;
const JPEG_Q = 0.55;

export async function fileToBase64(file, compress = true) {
  const name = file.name || 'file';
  const isPdf = name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
  if (isPdf || !compress) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        resolve({
          base64: reader.result.split(',')[1],
          mime: isPdf ? 'application/pdf' : (file.type || 'image/jpeg'),
          name
        });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
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

async function callEdge(payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
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
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}
    if (res.ok && json && !json.error) return json;
    // parse_fail with siswa still ok
    if (res.ok && json?.siswa) return json;
    const detail = json?.error || text.slice(0, 400) || ('HTTP ' + res.status);
    throw new Error(detail);
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Timeout server (90 dtk). Kurangi jumlah foto kunci per batch atau kompres foto.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fase 1: ekstrak kunci dari halaman soal/kunci (2–3 file per request)
 */
async function extractKeyFromPages(keyFiles, options = {}) {
  const pages = [];
  for (const f of keyFiles) pages.push(await fileToBase64(f, true));

  const merged = { pg: [], essay: [], meta: {}, soal_pg: [], soal_essay: [] };
  const chunkSize = 2;

  for (let i = 0; i < pages.length; i += chunkSize) {
    const chunk = pages.slice(i, i + chunkSize);
    if (options.onProgress) {
      await options.onProgress(
        `Membaca kunci/soal file ${i + 1}–${Math.min(i + chunkSize, pages.length)} dari ${pages.length}: ${chunk.map(c => c.name).join(', ')}`
      );
    }

    const custom = options.extra ? `\nINSTRUKSI TAMBAHAN USER:\n${options.extra}\n` : '';
    const payload = {
      mode: 'extract_key',
      keys: chunk,
      students: [],
      onlineKey: !!options.onlineKey,
      extra: `Fase ekstrak KUNCI/SOAL saja. Foto bisa miring, terbalik, upside-down — putar mental dulu lalu baca.
${custom}
JSON:
{"meta":{"sekolah":"","kelas":"","tanggal":"","mapel":""},"kunci_pg":[{"nomor":1,"soal":"redaksi singkat","kunci":"A"}],"kunci_essay":[{"nomor":1,"soal":"pertanyaan","kunci":"poin jawaban benar"}],"tidak_terbaca":[],"catatan":""}`
    };

    try {
      const result = await callEdge(payload);
      if (result.meta) Object.assign(merged.meta, result.meta);
      if (result.kunci_pg) merged.pg.push(...result.kunci_pg);
      if (result.kunci_essay) merged.essay.push(...result.kunci_essay);
      // fallback if AI returned full grade shape
      if (result.siswa?.[0]?.pg?.items) {
        for (const it of result.siswa[0].pg.items) {
          merged.pg.push({ nomor: it.nomor, soal: it.soal, kunci: it.kunci });
        }
      }
      if (result.siswa?.[0]?.essay?.items) {
        for (const it of result.siswa[0].essay.items) {
          merged.essay.push({ nomor: it.nomor, soal: it.soal, kunci: it.kunci });
        }
      }
      if (result.tidak_terbaca?.length && options.onProgress) {
        await options.onProgress('Peringatan: ' + result.tidak_terbaca.join(', '));
      }
    } catch (e) {
      if (options.onProgress) await options.onProgress('Gagal baca kunci chunk: ' + e.message);
      throw e;
    }
  }

  return merged;
}

/**
 * Fase 2: nilai 1 siswa dengan kunci teks (tanpa kirim ulang semua foto kunci)
 */
async function gradeOneStudent(studentFile, keyData, options = {}) {
  const student = await fileToBase64(studentFile, true);
  const custom = options.extra ? `\nINSTRUKSI TAMBAHAN USER:\n${options.extra}\n` : '';

  const keyText = JSON.stringify({
    meta: keyData.meta,
    kunci_pg: keyData.pg,
    kunci_essay: keyData.essay
  });

  const payload = {
    mode: 'grade_student',
    keys: [],
    students: [student],
    keyText,
    onlineKey: !!options.onlineKey,
    extra: `Fase NILAI SISWA. Kunci sudah diekstrak (JSON di bawah). Foto siswa bisa miring/terbalik — putar mental dulu.
Jika file tidak terbaca: nama="Tidak terbaca", score=0.
${custom}
KUNCI_JSON:
${keyText}

Balas JSON:
{"meta":{"sekolah":"","kelas":"","tanggal":"","mapel":""},"siswa":[{"nama":"","kelas":"","file":"${student.name}","score":0,"pg":{"benar":0,"total":0,"persen":0,"items":[{"nomor":1,"soal":"","kunci":"","siswa":"","benar":true,"skor":100}]},"essay":{"skor_total":0,"skor_maks":100,"persen":0,"items":[{"nomor":1,"soal":"","kunci":"","siswa":"","benar":true,"skor":80}]}}],"missing":[],"ringkasan":""}`
  };

  return callEdge(payload);
}

/**
 * Alur utama: ekstrak kunci → nilai tiap siswa
 */
export async function gradeBatch(keyFiles, studentFiles, options = {}) {
  if (!studentFiles?.length) throw new Error('Tidak ada lembar siswa');

  // Jika dipanggil hanya 1 siswa + kunci sudah ada (internal), skip
  const keyData = options._keyData || await extractKeyFromPages(keyFiles || [], options);

  if (!options._keyData) {
    // first call with all students handled by app.js loop
  }

  const sf = studentFiles[0];
  if (options.onProgress) {
    await options.onProgress(`Menilai siswa: ${sf.name}`);
  }
  const result = await gradeOneStudent(sf, keyData, options);
  result._keyData = keyData;
  return result;
}

/** Export untuk app: ekstrak kunci sekali */
export async function extractKeys(keyFiles, options = {}) {
  return extractKeyFromPages(keyFiles, options);
}

export async function gradeStudentWithKey(studentFile, keyData, options = {}) {
  return gradeOneStudent(studentFile, keyData, options);
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
