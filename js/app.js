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
  timerInterval: null
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

function setupConfigModal() {
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
    checkAuth();
  });

  $('#btn-skip-config')?.addEventListener('click', () => {
    saveConfig({ skipped: true });
    $('#config-modal').classList.add('hidden');
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
      alert('Login gagal: ' + e.message + '\nPastikan Supabase sudah dikonfigurasi & Google provider diaktifkan.');
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
  return {
    school: $('#meta-school')?.value || '',
    class: $('#meta-class')?.value || '',
    date: $('#meta-date')?.value || '',
    room: $('#meta-room')?.value || ''
  };
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

  state.startTime = Date.now();
  state.timerInterval = setInterval(() => {
    const elapsed = (Date.now() - state.startTime) / 1000;
    $('#progress-elapsed').textContent = formatTime(elapsed);
  }, 500);

  const totalSteps = state.keyFiles.length + state.studentFiles.length + 2;
  let step = 0;

  const setProgress = (pct, status) => {
    $('#progress-bar').style.width = `${pct}%`;
    $('#progress-status').textContent = status;
  };

  try {
    // 1. OCR Kunci Jawaban
    setProgress(5, 'Membaca kunci jawaban...');
    for (let i = 0; i < state.keyFiles.length; i++) {
      const f = state.keyFiles[i];
      setProgress(5 + (i / state.keyFiles.length) * 25, `OCR kunci: ${f.name}`);
      const result = await processFile(f, state.geminiKey, true);
      state.keyResults.push(result);
      step++;
    }

    // Merge key answers
    const mergedKey = mergeKeyResults(state.keyResults);

    // 2. Online second opinion (optional)
    let onlineKey = null;
    if ($('#online-key')?.checked && state.geminiKey) {
      setProgress(35, 'Mencari second opinion kunci online (AI)...');
      // Ambil teks soal dari hasil OCR jika ada
      const sampleQ = state.keyResults.find(r => r.teks_soal)?.teks_soal ||
        (mergedKey.jawaban?.[0] ? `Soal nomor ${mergedKey.jawaban[0].nomor}` : null);
      if (sampleQ) {
        onlineKey = await searchAnswerKeyOnline(sampleQ, state.geminiKey);
      }
    }

    // 3. OCR Lembar Siswa
    setProgress(40, 'Membaca lembar jawaban siswa...');
    for (let i = 0; i < state.studentFiles.length; i++) {
      const f = state.studentFiles[i];
      setProgress(40 + (i / state.studentFiles.length) * 45, `OCR siswa: ${f.name}`);
      const result = await processFile(f, state.geminiKey, true);
      // Jika nama kosong, pakai nama file
      if (!result.nama) result.nama = f.name.replace(/\.[^.]+$/, '');
      state.studentResults.push(result);
    }

    // 4. Scoring
    setProgress(90, 'Menghitung nilai...');
    state.scored = state.studentResults.map(st => scoreStudent(st, mergedKey, onlineKey));

    setProgress(100, 'Selesai!');
    await new Promise(r => setTimeout(r, 600));

    renderResults();
    progressSec.classList.add('hidden');
    resultsSec.classList.remove('hidden');
  } catch (err) {
    console.error(err);
    setProgress(0, 'Error: ' + err.message);
    alert('Terjadi kesalahan: ' + err.message);
  } finally {
    clearInterval(state.timerInterval);
    state.processing = false;
    updateStartButton();
  }
}

function mergeKeyResults(results) {
  const jawaban = [];
  const seen = new Set();
  results.forEach(r => {
    (r.jawaban || []).forEach(j => {
      const n = Number(j.nomor);
      if (!seen.has(n)) {
        seen.add(n);
        jawaban.push(j);
      }
    });
  });
  return {
    jawaban,
    teks_soal: results.find(r => r.teks_soal)?.teks_soal || ''
  };
}

function renderResults() {
  const list = $('#results-list');
  if (!list) return;

  list.innerHTML = state.scored.map((r, idx) => `
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
