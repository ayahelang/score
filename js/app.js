import { initSupabase, getSupabase, signInWithGoogle, signOut, getSession, onAuthStateChange } from './supabase.js';
import { processFile, searchAnswerKeyOnline } from './ocr.js';
import { scoreStudent, analyzeItems } from './scoring.js';
import { exportToPDF, exportToExcel, exportAnalysisPDF } from './export.js';
import { formatTime, extractFilesFromZip, saveConfig, loadConfig } from './utils.js';

// State
const state = {
  keyFiles: [],
  studentFiles: [],
  keyResults: [],
  studentResults: [],
  scored: [],
  analysis: null,
  geminiKey: '',
  config: {},
  processing: false,
  startTime: 0,
  timerInterval: null,
  extractedMeta: { school: null, class: null, date: null, room: null },
  missingReport: []
};

// DOM refs
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// Init
document.addEventListener('DOMContentLoaded', async () => {
  setupTheme();
  setupUploadZones();
  setupButtons();
  setupConfigModal();

  const cfg = loadConfig();
  state.config = cfg;
  state.geminiKey = cfg.geminiKey || '';

  if (cfg.supabaseUrl && cfg.supabaseKey) {
    initSupabase(cfg.supabaseUrl, cfg.supabaseKey);
    await checkAuth();
  } else if (!cfg.skipped) {
    $('#config-modal').classList.remove('hidden');
  }

  updateStartButton();
});

function setupTheme() {
  const saved = localStorage.getItem('sh_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  $('#btn-theme')?.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('sh_theme', next);
  });
}

function clearMetaFields() {
  ['meta-school', 'meta-class', 'meta-date', 'meta-room'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.value = '';
      el.defaultValue = '';
      // Cegah browser autofill mengisi key ke field ini
      el.setAttribute('autocomplete', 'off');
      el.setAttribute('data-lpignore', 'true');
      el.setAttribute('data-form-type', 'other');
    }
  });
}

function setupConfigModal() {
  // Bersihkan field meta saat load (melawan browser autofill yang mengisi key)
  clearMetaFields();
  setTimeout(clearMetaFields, 150);
  setTimeout(clearMetaFields, 600);
  setTimeout(clearMetaFields, 1500);

  $('#btn-save-config')?.addEventListener('click', () => {
    const url = $('#cfg-supabase-url').value.trim();
    const key = $('#cfg-supabase-key').value.trim();
    const gemini = $('#cfg-gemini-key').value.trim();
    const cfg = { supabaseUrl: url, supabaseKey: key, geminiKey: gemini };
    saveConfig(cfg);
    state.config = cfg;
    state.geminiKey = gemini;
    if (url && key) initSupabase(url, key);
    $('#config-modal').classList.add('hidden');
    // Pastikan meta tidak ikut terisi setelah simpan config
    clearMetaFields();
    checkAuth();
  });

  $('#btn-skip-config')?.addEventListener('click', () => {
    saveConfig({ skipped: true });
    $('#config-modal').classList.add('hidden');
    clearMetaFields();
  });
}

async function checkAuth() {
  const session = await getSession();
  updateAuthUI(session);
  onAuthStateChange((session) => updateAuthUI(session));
}

function updateAuthUI(session) {
  const loginBtn = $('#btn-login');
  const userInfo = $('#user-info');
  if (session?.user) {
    loginBtn?.classList.add('hidden');
    userInfo?.classList.remove('hidden');
    $('#user-name').textContent = session.user.user_metadata?.full_name || session.user.email || 'User';
    const avatar = session.user.user_metadata?.avatar_url;
    if (avatar) $('#user-avatar').src = avatar;
  } else {
    loginBtn?.classList.remove('hidden');
    userInfo?.classList.add('hidden');
  }
}

function setupUploadZones() {
  setupZone('key-zone', 'key-input', 'key');
  setupZone('student-zone', 'student-input', 'student');
}

function setupZone(zoneId, inputId, type) {
  const zone = $(`#${zoneId}`);
  const input = $(`#${inputId}`);

  zone?.addEventListener('click', () => input.click());
  zone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('dragover');
  });
  zone?.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone?.addEventListener('drop', async (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    await handleFiles(e.dataTransfer.files, type);
  });

  input?.addEventListener('change', async (e) => {
    await handleFiles(e.target.files, type);
    input.value = '';
  });
}

async function handleFiles(fileList, type) {
  const files = Array.from(fileList);
  const expanded = [];

  for (const f of files) {
    if (f.name.toLowerCase().endsWith('.zip') || f.type === 'application/zip') {
      try {
        const inner = await extractFilesFromZip(f);
        expanded.push(...inner);
      } catch (err) {
        console.error('ZIP error', err);
        alert('Gagal membuka ZIP: ' + err.message);
      }
    } else {
      expanded.push(f);
    }
  }

  if (type === 'key') {
    state.keyFiles.push(...expanded);
    renderFileList('key-list', state.keyFiles, 'key');
    $('#key-count').textContent = `${state.keyFiles.length} file`;
  } else {
    state.studentFiles.push(...expanded);
    renderFileList('student-list', state.studentFiles, 'student');
    $('#student-count').textContent = `${state.studentFiles.length} file`;
  }

  updateStartButton();
}

function renderFileList(containerId, files, type) {
  const el = $(`#${containerId}`);
  if (!el) return;
  el.innerHTML = files.map((f, i) => `
    <div class="file-item">
      <span class="name" title="${f.name}">${f.name}</span>
      <button class="remove" data-type="${type}" data-idx="${i}">✕</button>
    </div>
  `).join('');

  el.querySelectorAll('.remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const t = btn.dataset.type;
      const idx = parseInt(btn.dataset.idx, 10);
      if (t === 'key') {
        state.keyFiles.splice(idx, 1);
        renderFileList('key-list', state.keyFiles, 'key');
        $('#key-count').textContent = `${state.keyFiles.length} file`;
      } else {
        state.studentFiles.splice(idx, 1);
        renderFileList('student-list', state.studentFiles, 'student');
        $('#student-count').textContent = `${state.studentFiles.length} file`;
      }
      updateStartButton();
    });
  });
}

function updateStartButton() {
  const btn = $('#btn-start');
  const ready = state.keyFiles.length > 0 && state.studentFiles.length > 0 && !state.processing;
  btn.disabled = !ready;
  $('#start-hint').textContent = ready
    ? 'Siap! Klik untuk memulai penilaian AI'
    : 'Upload minimal 1 kunci jawaban & 1 lembar siswa untuk mengaktifkan tombol';
}

function setupButtons() {
  $('#btn-login')?.addEventListener('click', async () => {
    try {
      await signInWithGoogle();
    } catch (e) {
      alert('Login gagal: ' + e.message +
        '\n\nPastikan:\n1. Google provider sudah diaktifkan di Supabase\n2. Site URL di Supabase Authentication → URL Configuration sudah diganti ke URL GitHub Pages kamu (bukan localhost)\n3. Redirect URL di Google Cloud sama dengan Callback Supabase');
    }
  });

  $('#btn-logout')?.addEventListener('click', async () => {
    await signOut();
  });

  $('#btn-start')?.addEventListener('click', startScoring);

  $('#btn-export-pdf')?.addEventListener('click', () => {
    const meta = getMeta();
    exportToPDF(state.scored, meta);
  });

  $('#btn-export-excel')?.addEventListener('click', () => {
    const meta = getMeta();
    exportToExcel(state.scored, meta);
  });

  $('#btn-analysis')?.addEventListener('click', () => {
    state.analysis = analyzeItems(state.scored);
    renderAnalysis();
    $('#analysis-section').classList.remove('hidden');
  });

  $('#btn-close-analysis')?.addEventListener('click', () => {
    $('#analysis-section').classList.add('hidden');
  });

  $('#btn-download-analysis')?.addEventListener('click', () => {
    if (state.analysis) exportAnalysisPDF(state.analysis);
  });
}

function getMeta() {
  // Prioritas: isian user → hasil scan OCR
  return {
    school: $('#meta-school')?.value?.trim() || state.extractedMeta.school || '',
    class: $('#meta-class')?.value?.trim() || state.extractedMeta.class || '',
    date: $('#meta-date')?.value?.trim() || state.extractedMeta.date || '',
    room: $('#meta-room')?.value?.trim() || state.extractedMeta.room || ''
  };
}

function buildMissingReport(allResults) {
  const missing = [];
  const hasSchool = allResults.some(r => r.sekolah);
  const hasClass = allResults.some(r => r.kelas);
  const hasDate = allResults.some(r => r.tanggal);
  const hasMapel = allResults.some(r => r.mapel);
  const hasNama = allResults.some(r => r.nama && r.nama !== 'Tanpa Nama');
  const hasJawaban = allResults.some(r => (r.jawaban || []).length > 0);

  if (!hasSchool) missing.push('Nama sekolah');
  if (!hasClass) missing.push('Kelas');
  if (!hasDate) missing.push('Tanggal ujian');
  if (!hasMapel) missing.push('Mata pelajaran / Ruang');
  if (!hasNama) missing.push('Nama siswa (beberapa file)');
  if (!hasJawaban) missing.push('Daftar jawaban per nomor');

  // Cek apakah ada kunci yang valid
  const goodKeys = (state.keyResults || []).filter(r =>
    (r.kepercayaan_kunci || 0) >= 50 ||
    ['kunci_jawaban', 'modul_ajar'].includes(r.dokumen_tipe)
  );
  if (goodKeys.length === 0 && (state.keyResults || []).length > 0) {
    missing.push('Kunci jawaban yang jelas (file yang diupload sebagai kunci kemungkinan hanya lembar sudah dinilai)');
  }

  return missing;
}

async function startScoring() {
  if (state.processing) return;
  state.processing = true;
  state.scored = [];
  state.keyResults = [];
  state.studentResults = [];
  updateStartButton();

  const progressSec = $('#progress-section');
  const resultsSec = $('#results-section');
  progressSec.classList.remove('hidden');
  resultsSec.classList.add('hidden');
  $('#analysis-section').classList.add('hidden');

  // Scroll ke progress supaya user langsung melihat
  progressSec.scrollIntoView({ behavior: 'smooth', block: 'center' });

  state.startTime = Date.now();
  state.timerInterval = setInterval(() => {
    const elapsed = (Date.now() - state.startTime) / 1000;
    const el = $('#progress-elapsed');
    if (el) el.textContent = formatTime(elapsed);
  }, 400);

  // setProgress async supaya browser sempat repaint (progress bar & teks terlihat real-time)
  const setProgress = async (pct, status) => {
    const bar = $('#progress-bar');
    const statusEl = $('#progress-status');
    const titleEl = $('#progress-title');
    if (bar) bar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    if (statusEl) statusEl.textContent = status;
    if (titleEl) titleEl.textContent = pct >= 100 ? 'Selesai!' : 'Sedang memproses...';
    // Yield ke event loop agar UI update terlihat
    await new Promise(r => setTimeout(r, 50));
  };

  try {
    // 1. OCR Kunci Jawaban
    await setProgress(3, 'Menyiapkan pembacaan kunci jawaban / modul...');
    for (let i = 0; i < state.keyFiles.length; i++) {
      const f = state.keyFiles[i];
      const pct = 5 + ((i + 0.5) / Math.max(state.keyFiles.length, 1)) * 28;
      await setProgress(pct, `OCR kunci (${i + 1}/${state.keyFiles.length}): ${f.name}`);
      const result = await processFile(f, state.geminiKey, true, 'key');
      state.keyResults.push(result);
      await setProgress(5 + ((i + 1) / Math.max(state.keyFiles.length, 1)) * 28, `Selesai OCR kunci: ${f.name}`);
    }

    // Merge key answers (dengan filter kepercayaan)
    await setProgress(35, 'Menggabungkan kunci jawaban...');
    const mergedKey = mergeKeyResults(state.keyResults);

    // Auto-isi meta dari hasil OCR jika user tidak mengisi
    autoFillMetaFromResults([...state.keyResults]);

    // 2. Online second opinion (optional)
    let onlineKey = null;
    if ($('#online-key')?.checked && state.geminiKey) {
      await setProgress(38, 'Mencari second opinion kunci online (AI)...');
      const sampleQ = state.keyResults.find(r => r.teks_soal)?.teks_soal ||
        (mergedKey.jawaban?.[0] ? `Soal nomor ${mergedKey.jawaban[0].nomor}` : null);
      if (sampleQ) {
        onlineKey = await searchAnswerKeyOnline(sampleQ, state.geminiKey);
      }
      await setProgress(42, 'Second opinion selesai');
    }

    // 3. OCR Lembar Siswa
    await setProgress(45, 'Mulai membaca lembar jawaban siswa...');
    for (let i = 0; i < state.studentFiles.length; i++) {
      const f = state.studentFiles[i];
      const pct = 45 + ((i + 0.5) / Math.max(state.studentFiles.length, 1)) * 40;
      await setProgress(pct, `OCR siswa (${i + 1}/${state.studentFiles.length}): ${f.name}`);
      const result = await processFile(f, state.geminiKey, true, 'student');
      if (!result.nama) result.nama = f.name.replace(/\.[^.]+$/, '');
      state.studentResults.push(result);
      await setProgress(45 + ((i + 1) / Math.max(state.studentFiles.length, 1)) * 40, `Selesai OCR siswa: ${f.name}`);
    }

    // Auto-isi meta lagi dari data siswa (jika masih kosong)
    autoFillMetaFromResults(state.studentResults);

    // Simpan meta hasil scan + laporan data yang tidak ditemukan
    state.extractedMeta = extractMetaFromResults([...state.keyResults, ...state.studentResults]);
    state.missingReport = buildMissingReport([...state.keyResults, ...state.studentResults]);

    // 4. Scoring
    await setProgress(90, 'Menghitung nilai siswa...');
    state.scored = state.studentResults.map(st => scoreStudent(st, mergedKey, onlineKey));

    await setProgress(98, 'Menyiapkan tampilan hasil...');
    await setProgress(100, 'Selesai! Menampilkan hasil...');
    await new Promise(r => setTimeout(r, 500));

    renderResults();
    progressSec.classList.add('hidden');
    resultsSec.classList.remove('hidden');
    resultsSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    console.error(err);
    await setProgress(0, 'Error: ' + err.message);
    alert('Terjadi kesalahan: ' + err.message);
  } finally {
    clearInterval(state.timerInterval);
    state.processing = false;
    updateStartButton();
  }
}

/**
 * Gabungkan kunci jawaban.
 * Prioritas tinggi: modul_ajar / kunci_jawaban dengan kepercayaan tinggi.
 * Lembar yang sudah dinilai (hanya ada nilai dilingkari) → prioritas rendah.
 */
function mergeKeyResults(results) {
  const jawabanMap = new Map(); // nomor → { jawaban, score, source }

  // Urutkan: kepercayaan tinggi dulu
  const sorted = [...results].sort((a, b) => (b.kepercayaan_kunci || 0) - (a.kepercayaan_kunci || 0));

  sorted.forEach(r => {
    const conf = r.kepercayaan_kunci || 0;
    const tipe = r.dokumen_tipe || '';

    // Skip jika jelas-jelas lembar siswa yang sudah dinilai dengan conf rendah
    if (tipe === 'lembar_sudah_dinilai' && conf < 50) {
      console.log('Skip sebagai kunci utama (lembar sudah dinilai):', r);
      // Tetap boleh dipakai sebagai supplementary jika tidak ada kunci lain
    }

    (r.jawaban || []).forEach(j => {
      const n = Number(j.nomor);
      if (!n) return;
      const existing = jawabanMap.get(n);
      // Ganti hanya jika yang baru punya conf lebih tinggi, atau belum ada
      if (!existing || conf > existing.score) {
        jawabanMap.set(n, {
          jawaban: j.jawaban,
          score: conf,
          source: tipe
        });
      }
    });
  });

  const jawaban = [];
  jawabanMap.forEach((val, nomor) => {
    jawaban.push({ nomor, jawaban: val.jawaban });
  });
  jawaban.sort((a, b) => a.nomor - b.nomor);

  return {
    jawaban,
    teks_soal: results.find(r => r.teks_soal)?.teks_soal || '',
    meta: extractMetaFromResults(results)
  };
}

function extractMetaFromResults(results) {
  const meta = { school: null, class: null, date: null, room: null };
  for (const r of results) {
    if (!meta.school && r.sekolah) meta.school = r.sekolah;
    if (!meta.class && r.kelas) meta.class = r.kelas;
    if (!meta.date && r.tanggal) meta.date = r.tanggal;
    if (!meta.room && r.mapel) meta.room = r.mapel;
  }
  return meta;
}

/** Isi field meta di form jika masih kosong */
function autoFillMetaFromResults(results) {
  const extracted = extractMetaFromResults(results);
  if (extracted.school && !$('#meta-school').value) {
    $('#meta-school').value = extracted.school;
  }
  if (extracted.class && !$('#meta-class').value) {
    $('#meta-class').value = extracted.class;
  }
  if (extracted.date && !$('#meta-date').value) {
    // Coba parse ke format date input (YYYY-MM-DD) jika memungkinkan
    $('#meta-date').value = tryParseDate(extracted.date) || '';
    // Juga simpan teks asli di room jika perlu
  }
  if (extracted.room && !$('#meta-room').value) {
    $('#meta-room').value = extracted.room;
  }
}

function tryParseDate(str) {
  if (!str) return '';
  // Coba format Indonesia umum
  const m = String(str).match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
  if (m) {
    let y = m[3];
    if (y.length === 2) y = '20' + y;
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return '';
}

function renderResults() {
  const list = $('#results-list');
  if (!list) return;

  const meta = getMeta();
  const missing = state.missingReport || [];

  // Ringkasan info ujian (dari isian user atau hasil scan)
  const metaRows = [
    { label: 'Sekolah', value: meta.school },
    { label: 'Kelas', value: meta.class },
    { label: 'Tanggal', value: meta.date },
    { label: 'Ruang / Mapel', value: meta.room }
  ];

  const metaHtml = `
    <div class="meta-summary" style="margin-bottom:1rem;padding:0.85rem 1rem;background:var(--bg-elevated);border-radius:10px;border:1px solid var(--border);">
      <div style="font-weight:600;margin-bottom:0.5rem;color:var(--accent);">📋 Informasi Ujian</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:0.4rem 1rem;font-size:0.9rem;">
        ${metaRows.map(m => `
          <div>
            <span style="color:var(--text-muted);">${m.label}:</span>
            <strong>${m.value ? escapeHtml(m.value) : '<span style="color:var(--warning);font-weight:500;">Tidak ditemukan di file</span>'}</strong>
          </div>
        `).join('')}
      </div>
      ${missing.length ? `
        <div style="margin-top:0.75rem;padding-top:0.65rem;border-top:1px solid var(--border);font-size:0.85rem;color:var(--text-muted);">
          <strong style="color:var(--warning);">⚠️ Data yang dicari tapi tidak ditemukan:</strong>
          <ul style="margin:0.35rem 0 0 1.1rem;padding:0;">
            ${missing.map(x => `<li>${escapeHtml(x)}</li>`).join('')}
          </ul>
        </div>
      ` : `
        <div style="margin-top:0.65rem;font-size:0.85rem;color:var(--success);">✓ Semua data meta penting berhasil ditemukan dari file.</div>
      `}
    </div>
  `;

  const studentsHtml = state.scored.map((r, idx) => `
    <div class="result-item" data-idx="${idx}">
      <div class="result-header">
        <div>
          <span class="result-name">${escapeHtml(r.nama)}</span>
          ${r.kelas ? `<span class="hint"> • ${escapeHtml(r.kelas)}</span>` : ''}
        </div>
        <span class="result-score">${r.score}</span>
      </div>
      <div class="result-body">
        <div class="qa-row" style="font-weight:600;color:var(--text-muted)">
          <span>No</span><span>Jawaban Siswa</span><span>Kunci / Status</span>
        </div>
        ${r.details.map(d => `
          <div class="qa-row">
            <span class="qa-num">${d.nomor}</span>
            <span>${escapeHtml(String(d.siswa || '-'))}</span>
            <span class="${d.benar ? 'qa-correct' : 'qa-wrong'}">
              ${escapeHtml(String(d.kunci || '-'))} ${d.benar ? '✓' : '✗'}
            </span>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');

  list.innerHTML = metaHtml + studentsHtml;

  list.querySelectorAll('.result-header').forEach(header => {
    header.addEventListener('click', () => {
      header.parentElement.classList.toggle('open');
    });
  });
}

function renderAnalysis() {
  const el = $('#analysis-content');
  if (!el || !state.analysis) return;
  const a = state.analysis;
  el.innerHTML = `
    <p>Jumlah siswa: <strong>${a.jumlah_siswa}</strong> • Rata-rata nilai: <strong>${a.rata_rata}</strong></p>
    <div style="overflow-x:auto;margin-top:1rem">
      <table style="width:100%;border-collapse:collapse;font-size:0.9rem">
        <thead>
          <tr style="border-bottom:1px solid var(--border)">
            <th style="padding:0.5rem;text-align:left">No</th>
            <th style="padding:0.5rem">N Siswa</th>
            <th style="padding:0.5rem">Benar</th>
            <th style="padding:0.5rem">Kesukaran</th>
            <th style="padding:0.5rem">Kategori</th>
          </tr>
        </thead>
        <tbody>
          ${a.items.map(it => `
            <tr style="border-bottom:1px solid var(--border)">
              <td style="padding:0.5rem">${it.nomor}</td>
              <td style="padding:0.5rem;text-align:center">${it.total_siswa}</td>
              <td style="padding:0.5rem;text-align:center">${it.benar}</td>
              <td style="padding:0.5rem;text-align:center">${it.tingkat_kesukaran}%</td>
              <td style="padding:0.5rem;text-align:center">${it.kategori}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
