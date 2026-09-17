import { initSupabase, getSupabase, signInWithGoogle, signOut, getSession, onAuthStateChange } from './supabase.js';
import { extractKeys, gradeStudentWithKey } from './ocr.js';
import { APP_CONFIG } from './config.js';
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


/** Bunyi sukses singkat (Web Audio) — guru bisa dengar dari jauh */
let _audioCtx = null;
function playSuccessChime() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!_audioCtx) _audioCtx = new AC();
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    const ctx = _audioCtx;
    const now = ctx.currentTime;
    // Dua nada gembira naik
    const notes = [523.25, 659.25, 783.99]; // C5 E5 G5
    notes.forEach((freq, i) => {
      const t0 = now + i * 0.09;
      [1, 2].forEach((mult, hi) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = hi ? 'triangle' : 'sine';
        o.frequency.value = freq * mult;
        const vol = hi ? 0.12 : 0.36;
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(vol, t0 + 0.025);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.35);
        o.connect(g);
        g.connect(ctx.destination);
        o.start(t0);
        o.stop(t0 + 0.38);
      });
    });
  } catch (_) {}
}

function playDoneFanfare() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!_audioCtx) _audioCtx = new AC();
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    const ctx = _audioCtx;
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.38, now + 0.03 + i * 0.1);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.45 + i * 0.1);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(now + i * 0.1);
      o.stop(now + 0.5 + i * 0.1);
    });
  } catch (_) {}
}

function tickElapsed() {
  if (!state.startTime) return;
  const el = document.getElementById('progress-elapsed');
  if (el) el.textContent = formatTime((Date.now() - state.startTime) / 1000);
}

// DOM refs
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// Init
document.addEventListener('DOMContentLoaded', async () => {
  setupTheme();
  setupUploadZones();
  setupButtons();
  setupConfigModal();

  // Config publik — pengguna tidak perlu input Gemini key / localStorage rahasia
  state.config = { supabaseUrl: APP_CONFIG.supabaseUrl, supabaseKey: APP_CONFIG.supabaseAnonKey };
  state.geminiKey = '';
  initSupabase(APP_CONFIG.supabaseUrl, APP_CONFIG.supabaseAnonKey);
  await checkAuth();
  $('#config-modal')?.classList.add('hidden');

  updateStartButton();
  setupFeedbackUI();
  loadTestimonials();
});

function setupFeedbackUI() {
  $('#btn-feedback-mini')?.addEventListener('click', () => expandFeedbackModal());
  document.getElementById('teddy-name-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    const note = document.getElementById('teddy-note');
    if (note) note.classList.toggle('hidden');
  });

  $('#btn-like-app')?.addEventListener('click', () => {
    $('#feedback-step-1')?.classList.add('hidden');
    $('#feedback-step-2')?.classList.remove('hidden');
  });
  $('#btn-dislike-app')?.addEventListener('click', () => {
    sessionStorage.setItem('sh_feedback_done', '1');
    shrinkFeedbackModal();
  });
  $('#btn-skip-feedback')?.addEventListener('click', () => {
    sessionStorage.setItem('sh_feedback_done', '1');
    shrinkFeedbackModal();
  });
  $('#btn-submit-testimonial')?.addEventListener('click', async () => {
    const name = $('#fb-name')?.value?.trim() || 'Anonim';
    const comment = $('#fb-comment')?.value?.trim() || '';
    await submitTestimonial(name, comment, true);
    sessionStorage.setItem('sh_feedback_done', '1');
    $('#feedback-step-2')?.classList.add('hidden');
    $('#feedback-step-3')?.classList.remove('hidden');
    sessionStorage.setItem('sh_feedback_submitted', '1');
    loadTestimonials();
    setTimeout(() => {
      shrinkFeedbackModal();
    }, 1800);
  });
  $('#btn-close-feedback')?.addEventListener('click', () => {
    sessionStorage.setItem('sh_feedback_done', '1');
    shrinkFeedbackModal();
  });
}


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
  // revoke old urls
  el.querySelectorAll('.file-thumb img').forEach(img => {
    if (img.src && img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
  });

  el.innerHTML = files.map((f, i) => {
    const isImg = /\.(jpe?g|png|gif|webp)$/i.test(f.name) || (f.type || '').startsWith('image/');
    const thumbId = `thumb-${type}-${i}`;
    return `
    <div class="file-item" data-idx="${i}">
      <span class="name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
      <button type="button" class="remove" data-type="${type}" data-idx="${i}">✕</button>
      <div class="file-thumb hidden" id="${thumbId}"></div>
    </div>`;
  }).join('');

  files.forEach((f, i) => {
    const item = el.querySelector(`.file-item[data-idx="${i}"]`);
    const thumb = item?.querySelector('.file-thumb');
    if (!item || !thumb) return;
    const isImg = /\.(jpe?g|png|gif|webp)$/i.test(f.name) || (f.type || '').startsWith('image/');
    item.addEventListener('mouseenter', () => {
      if (!thumb.dataset.ready) {
        if (isImg) {
          const url = URL.createObjectURL(f);
          thumb.innerHTML = `<img src="${url}" alt="preview" />`;
          thumb.dataset.ready = '1';
        } else if (/\.pdf$/i.test(f.name)) {
          thumb.innerHTML = `<div class="thumb-pdf">PDF</div>`;
          thumb.dataset.ready = '1';
        } else {
          thumb.innerHTML = `<div class="thumb-pdf">FILE</div>`;
          thumb.dataset.ready = '1';
        }
      }
      // fixed di viewport agar list tetap overflow:auto di dalam kartu
      const rect = item.getBoundingClientRect();
      thumb.classList.remove('hidden');
      thumb.classList.add('file-thumb-fixed');
      thumb.style.left = Math.min(rect.left, window.innerWidth - 200) + 'px';
      thumb.style.top = Math.max(8, rect.top - 190) + 'px';
    });
    item.addEventListener('mouseleave', () => {
      thumb.classList.add('hidden');
      thumb.classList.remove('file-thumb-fixed');
    });
  });

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

function resetUploads() {
  state.keyFiles = [];
  state.studentFiles = [];
  state.scored = [];
  state.studentResults = [];
  state.keyResults = [];
  state.missingReport = [];
  renderFileList('key-list', [], 'key');
  renderFileList('student-list', [], 'student');
  $('#key-count').textContent = '0 file';
  $('#student-count').textContent = '0 file';
  $('#results-section')?.classList.add('hidden');
  $('#progress-section')?.classList.add('hidden');
  $('#analysis-section')?.classList.add('hidden');
  const list = $('#results-list');
  if (list) list.innerHTML = '';
  updateStartButton();
  window.scrollTo({ top: 0, behavior: 'smooth' });
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
  $('#btn-reset')?.addEventListener('click', () => {
    if (state.processing) return;
    if (state.keyFiles.length || state.studentFiles.length || state.scored.length) {
      if (!confirm('Kosongkan semua file upload & hasil?')) return;
    }
    resetUploads();
  });
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
  state.extractedMeta = { school: null, class: null, date: null, room: null };
  state.missingReport = [];
  updateStartButton();

  const progressSec = $('#progress-section');
  const resultsSec = $('#results-section');
  progressSec.classList.remove('hidden');
  resultsSec.classList.add('hidden');
  $('#analysis-section').classList.add('hidden');
  progressSec.scrollIntoView({ behavior: 'smooth', block: 'center' });

  state.startTime = Date.now();
  tickElapsed();
  if (state.timerInterval) clearInterval(state.timerInterval);
  if (state._elapsedRaf) cancelAnimationFrame(state._elapsedRaf);
  if (state._timerWorker) { try { state._timerWorker.terminate(); } catch(_){} state._timerWorker = null; }

  // Worker terpisah: detak tetap jalan meski main thread sibuk kompres gambar
  try {
    const blob = new Blob([`
      let t = null;
      onmessage = (e) => {
        if (e.data === 'start') {
          if (t) clearInterval(t);
          t = setInterval(() => postMessage('tick'), 250);
        } else if (e.data === 'stop') {
          if (t) clearInterval(t);
          t = null;
        }
      };
    `], { type: 'application/javascript' });
    state._timerWorker = new Worker(URL.createObjectURL(blob));
    state._timerWorker.onmessage = () => tickElapsed();
    state._timerWorker.postMessage('start');
  } catch (_) {
    state.timerInterval = setInterval(tickElapsed, 250);
  }
  // Cadangan main-thread
  state.timerInterval = setInterval(tickElapsed, 500);

  const progressLog = [];
  const logEl = $('#progress-log');
  if (logEl) logEl.innerHTML = '';

  const appendLog = (status, kind = 'run') => {
    // kind: run | done | warn | err
    if (progressLog.length) {
      const last = progressLog[progressLog.length - 1];
      if (last.kind === 'run') {
        last.kind = 'done';
        playSuccessChime(); // bunyi tiap langkah selesai
      }
    }
    progressLog.push({ status, kind, t: Date.now() });
    tickElapsed();
    if (logEl) {
      logEl.innerHTML = progressLog.map((e, i) => {
        const icon = e.kind === 'done' ? '✅' : e.kind === 'warn' ? '⚠️' : e.kind === 'err' ? '❌' : '⏳';
        return `<div class="plog-item plog-${e.kind}"><span class="plog-icon">${icon}</span><span class="plog-text">${escapeHtml(e.status)}</span></div>`;
      }).join('');
      logEl.scrollTop = logEl.scrollHeight;
    }
  };

  const setProgress = async (pct, status, kind = 'run') => {
    const bar = $('#progress-bar');
    const statusEl = $('#progress-status');
    const titleEl = $('#progress-title');
    if (pct != null && bar) bar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    if (statusEl && status) statusEl.textContent = status;
    if (titleEl) titleEl.textContent = (pct != null && pct >= 100) ? 'Selesai!' : 'Sedang memproses...';
    if (status) appendLog(status, kind);
    await new Promise(r => setTimeout(r, 35));
  };

  try {
    const online = !!$('#online-key')?.checked;
    const customExtra = ($('#custom-prompt')?.value || '').trim();
    const keyN = state.keyFiles.length;
    const stuN = state.studentFiles.length;

    const setProg = async (pct, status, kind = 'run') => {
      await setProgress(pct, status, kind);
    };

    await setProg(5, `Fase 1/2: membaca ${keyN} file kunci/soal (bisa miring/terbalik)...`);

    let keyData;
    try {
      keyData = await extractKeys(state.keyFiles, {
        onlineKey: online,
        extra: customExtra,
        onProgress: async (msg) => setProg(12, msg)
      });
    } catch (e) {
      throw new Error('Gagal ekstrak kunci: ' + e.message);
    }

    const pgN = (keyData.pg || []).length;
    const esN = (keyData.essay || []).length;
    await setProg(25, `Kunci siap: ${pgN} PG, ${esN} essay. Fase 2/2: nilai ${stuN} siswa...`);

    if (keyData.meta) {
      state.extractedMeta = {
        school: keyData.meta.sekolah || null,
        class: keyData.meta.kelas || null,
        date: keyData.meta.tanggal || null,
        room: keyData.meta.mapel || null
      };
      if (state.extractedMeta.school && !$('#meta-school').value) $('#meta-school').value = state.extractedMeta.school;
      if (state.extractedMeta.class && !$('#meta-class').value) $('#meta-class').value = state.extractedMeta.class;
      if (state.extractedMeta.room && !$('#meta-room').value) $('#meta-room').value = state.extractedMeta.room;
    }

    const mergedSiswa = [];
    let mergedMissing = [];
    let lastRingkasan = '';

    for (let i = 0; i < stuN; i++) {
      const sf = state.studentFiles[i];
      const basePct = 28 + Math.floor((i / Math.max(stuN, 1)) * 55);
      await setProg(basePct, `Menilai (${i + 1}/${stuN}): ${sf.name}`);

      let batchResult;
      try {
        batchResult = await gradeStudentWithKey(sf, keyData, {
          onlineKey: online,
          extra: customExtra,
          onProgress: async (msg) => setProg(basePct + 2, msg)
        });
      } catch (e) {
        mergedMissing.push(`${sf.name}: ${e.message}`);
        mergedSiswa.push({
          nama: 'Gagal / Tidak terbaca',
          kelas: '',
          file: sf.name,
          score: 0,
          pg: { benar: 0, total: 0, persen: 0, items: [] },
          essay: { skor_total: 0, skor_maks: 0, persen: 0, items: [] }
        });
        await setProg(basePct + 5, `Gagal: ${sf.name} — ${e.message.slice(0, 80)}`);
        continue;
      }

      if (batchResult.meta) {
        state.extractedMeta = {
          school: batchResult.meta.sekolah || state.extractedMeta.school,
          class: batchResult.meta.kelas || state.extractedMeta.class,
          date: batchResult.meta.tanggal || state.extractedMeta.date,
          room: batchResult.meta.mapel || state.extractedMeta.room
        };
      }
      if (Array.isArray(batchResult.missing)) mergedMissing = [...new Set([...mergedMissing, ...batchResult.missing])];
      if (batchResult.ringkasan) lastRingkasan = batchResult.ringkasan;
      const list = Array.isArray(batchResult.siswa) ? batchResult.siswa : [];
      for (const s of list) {
        if (!s.file) s.file = sf.name;
        mergedSiswa.push(s);
      }
      await setProg(basePct + 6, `Selesai: ${sf.name} → ${list[0]?.nama || 'OK'} (${list[0]?.score ?? '-'})`);
    }

    if (stuN === 0) throw new Error('Tidak ada lembar siswa');


    // Lengkapi redaksi soal dari kunci jika AI hanya kasih label pendek
    const soalMap = {};
    (keyData.pg || []).forEach(k => { if (k.nomor != null) soalMap['pg:' + k.nomor] = k.soal || k.kunci || ''; });
    (keyData.essay || []).forEach(k => { if (k.nomor != null) soalMap['es:' + k.nomor] = k.soal || k.kunci || ''; });
    for (const s of mergedSiswa) {
      if (s.pg?.items) {
        s.pg.items = s.pg.items.map(it => {
          let soal = (it.soal || '').trim();
          const alt = soalMap['pg:' + it.nomor] || soalMap['pg:' + String(it.nomor)] || '';
          if (!soal || soal.length < 12 || /^(dikte|imla|soal)/i.test(soal)) {
            if (alt && alt.length > soal.length) soal = alt;
            else if ((it.kunci || '').length > soal.length) soal = it.kunci;
          }
          return { ...it, soal: soal || it.soal || it.kunci || '' };
        });
      }
      if (s.essay?.items) {
        s.essay.items = s.essay.items.map(it => {
          let soal = (it.soal || '').trim();
          const alt = soalMap['es:' + it.nomor] || soalMap['es:' + String(it.nomor)] || '';
          if (!soal || soal.length < 12 || /^(dikte|imla|soal|kalimat)/i.test(soal)) {
            if (alt && alt.length > soal.length) soal = alt;
            else if ((it.kunci || '').length > soal.length) soal = it.kunci;
          }
          return { ...it, soal: soal || it.soal || it.kunci || '' };
        });
      }
    }

    const aiResult = {
      meta: {
        sekolah: state.extractedMeta.school,
        kelas: state.extractedMeta.class,
        tanggal: state.extractedMeta.date,
        mapel: state.extractedMeta.room
      },
      siswa: mergedSiswa,
      missing: mergedMissing,
      ringkasan: lastRingkasan || `Selesai ${mergedSiswa.length} siswa`,
      _usedModel: ''
    };

    await setProgress(82, 'Menyusun hasil penilaian...');

    // Map hasil AI ke state aplikasi
    const meta = aiResult.meta || {};
    state.extractedMeta = {
      school: meta.sekolah || null,
      class: meta.kelas || null,
      date: meta.tanggal || null,
      room: meta.mapel || null
    };
    // Auto-isi form jika kosong
    if (state.extractedMeta.school && !$('#meta-school').value) $('#meta-school').value = state.extractedMeta.school;
    if (state.extractedMeta.class && !$('#meta-class').value) $('#meta-class').value = state.extractedMeta.class;
    if (state.extractedMeta.date && !$('#meta-date').value) {
      const d = tryParseDate(state.extractedMeta.date);
      if (d) $('#meta-date').value = d;
    }
    if (state.extractedMeta.room && !$('#meta-room').value) $('#meta-room').value = state.extractedMeta.room;

    state.missingReport = Array.isArray(aiResult.missing) ? aiResult.missing : [];

    const siswaList = Array.isArray(aiResult.siswa) ? aiResult.siswa : [];
    state.studentResults = siswaList.map((s, i) => ({
      nama: s.nama || 'Tanpa Nama',
      kelas: s.kelas || '',
      jawaban: [],
      _fileHint: s.file || (state.studentFiles[i] && state.studentFiles[i].name.replace(/\.[^.]+$/, '')) || ''
    }));

    state.scored = siswaList.map((s) => {
      // Normalisasi struktur PG / Essay dari AI
      let pg = s.pg || null;
      let essay = s.essay || null;
      if (!pg && !essay && Array.isArray(s.details)) {
        const pgItems = s.details.filter(d => (d.tipe || 'pg') === 'pg' || String(d.siswa || '').length <= 3);
        const esItems = s.details.filter(d => !pgItems.includes(d));
        if (pgItems.length) {
          const benar = pgItems.filter(d => d.benar).length;
          pg = { benar, total: pgItems.length, persen: Math.round(benar / pgItems.length * 100), items: pgItems.map(d => ({
            nomor: d.nomor, soal: d.soal || '', kunci: d.kunci || '-', siswa: d.siswa || '-', benar: !!d.benar, skor: d.benar ? 100 : 0, catatan: d.catatan || ''
          })) };
        }
        if (esItems.length) {
          const skor = esItems.reduce((a, d) => a + (d.skor_butir || d.skor || (d.benar ? 100 : 0)), 0);
          const maks = esItems.length * 100;
          essay = { skor_total: skor, skor_maks: maks, persen: Math.round(skor / maks * 100), items: esItems.map(d => ({
            nomor: d.nomor, soal: d.soal || '', kunci: d.kunci || '-', siswa: d.siswa || '-', benar: !!d.benar, skor: d.skor_butir || d.skor || (d.benar ? 100 : 0), catatan: d.catatan || ''
          })) };
        }
      }
      if (pg && pg.items) {
        pg.benar = pg.benar ?? pg.items.filter(i => i.benar).length;
        pg.total = pg.total ?? pg.items.length;
        pg.persen = pg.persen ?? (pg.total ? Math.round(pg.benar / pg.total * 100) : 0);
      }
      if (essay && essay.items) {
        essay.skor_total = essay.skor_total ?? essay.items.reduce((a, i) => a + (i.skor || 0), 0);
        essay.skor_maks = essay.skor_maks ?? (essay.items.length * 100);
        essay.persen = essay.persen ?? (essay.skor_maks ? Math.round(essay.skor_total / essay.skor_maks * 100) : 0);
      }
      return {
        nama: s.nama || 'Tanpa Nama',
        kelas: s.kelas || '',
        score: typeof s.score === 'number' ? s.score : 0,
        correct: s.correct || (pg ? pg.benar : 0),
        total: s.total || (pg ? pg.total : 0),
        pg,
        essay,
        details: s.details || []
      };
    });

    if (aiResult._usedModel) {
      console.log('AI model used:', aiResult._usedModel);
    }

    // Jika AI tidak mengembalikan siswa sama sekali, fallback pesan
    if (state.scored.length === 0) {
      state.scored = [{
        nama: 'Tanpa Nama',
        kelas: '',
        score: 0,
        correct: 0,
        total: 1,
        details: [{ nomor: '-', siswa: '-', kunci: aiResult.ringkasan || aiResult.raw_text || 'AI tidak menemukan jawaban', benar: false }]
      }];
      state.missingReport.push('Hasil penilaian AI kosong – coba upload ulang atau periksa API key');
    }

    await setProgress(100, aiResult.ringkasan || 'Selesai! Menampilkan hasil...', 'done');
    playDoneFanfare();
    await new Promise(r => setTimeout(r, 500));

    renderResults();
    progressSec.classList.add('hidden');
    resultsSec.classList.remove('hidden');
    resultsSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    scheduleFeedbackModal();
  } catch (err) {
    console.error(err);
    await setProgress(0, 'Error: ' + err.message);
    alert('Terjadi kesalahan: ' + err.message);
  } finally {
    clearInterval(state.timerInterval);
    if (state._elapsedRaf) cancelAnimationFrame(state._elapsedRaf);
    if (state._timerWorker) {
      try { state._timerWorker.postMessage('stop'); state._timerWorker.terminate(); } catch(_){}
      state._timerWorker = null;
    }
    tickElapsed();
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


/** Pilih teks soal yang bermakna (hindari label template Imla/Dikte/Soal N) */
function resolveSoalText(it) {
  const soal = (it.soal || '').trim();
  const kunci = (it.kunci || '').trim();
  const siswa = (it.siswa || '').trim();
  const looksLikeLabel = (s) => {
    if (!s) return true;
    if (s.length < 8) return true;
    // "Dikte (Imla) Kalimat 2", "Soal 1", "Imla 3", "PG-1"
    if (/^(dikte|imla|soal|essay|pg|no\.?|nomor)(\s|\(|$)/i.test(s)) return true;
    if (/^kalimat\s*\d+/i.test(s)) return true;
    if (/^(soal|essay|pg)[\s\-_:]*\d+$/i.test(s)) return true;
    // hanya angka / nomor
    if (/^[\d\.\-\s]+$/.test(s)) return true;
    return false;
  };
  if (!looksLikeLabel(soal)) return soal;
  // Untuk imla/dikte, kunci = kalimat yang seharusnya
  if (kunci && !looksLikeLabel(kunci) && kunci.length >= 4) return kunci;
  if (siswa && !looksLikeLabel(siswa) && siswa.length >= 4) return siswa;
  return soal || kunci || '(Redaksi soal tidak tersedia dari AI — lihat kolom Kunci / Jawaban)';
}


/** Tampilkan huruf kunci + teks lengkap (bisa di-expand) */
function resolveKunciParts(it) {
  const raw = String(it.kunci || '').trim();
  const soal = resolveSoalText(it);
  // Ambil huruf A-E di awal jika ada
  const m = raw.match(/^([A-Ea-e])\b/);
  const letter = m ? m[1].toUpperCase() : (raw.length <= 3 ? raw.toUpperCase() : '');
  let full = raw;
  // Jika hanya huruf, coba tarik opsi dari redaksi soal (A. ... B. ...)
  if (letter && (raw.length <= 3 || raw === letter) && soal) {
    const re = new RegExp(letter + '[\\.)\\]\\s]+([^\\n]+)', 'i');
    const opt = soal.match(re);
    if (opt) full = letter + '. ' + opt[1].trim();
    else full = letter + (soal ? ' — lihat redaksi soal untuk opsi ' + letter : '');
  }
  if (!full) full = '(Kunci tidak tersedia)';
  const shortLabel = letter || (raw.length <= 8 ? raw : raw.slice(0, 8) + '…');
  return { short: shortLabel || '•', full };
}

function renderResults() {
  const list = $('#results-list');
  if (!list) return;

  const meta = getMeta();
  const missing = state.missingReport || [];

  const metaRows = [
    { label: 'Sekolah', value: meta.school },
    { label: 'Kelas', value: meta.class },
    { label: 'Tanggal', value: meta.date },
    { label: 'Ruang / Mapel', value: meta.room }
  ];

  const metaHtml = `
    <div class="meta-summary card-inner">
      <div class="meta-title">📋 Informasi Ujian</div>
      <div class="meta-grid">
        ${metaRows.map(m => `
          <div><span class="muted">${m.label}:</span>
          <strong>${m.value ? escapeHtml(m.value) : '<span class="warn-text">Tidak ditemukan di file</span>'}</strong></div>
        `).join('')}
      </div>
      ${missing.length ? `
        <div class="missing-box">
          <strong class="warn-text">⚠️ Data yang dicari tapi tidak ditemukan:</strong>
          <ul>${missing.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>
        </div>` : `<div class="ok-text">✓ Data meta penting berhasil ditemukan.</div>`}
    </div>`;

  // Tabel konsisten: No | Nama Siswa | Nilai
  const tableHead = `
    <div class="score-table">
      <div class="score-table-head">
        <span class="col-no">No</span>
        <span class="col-name">Nama Siswa</span>
        <span class="col-score">Nilai</span>
      </div>`;

  const rows = state.scored.map((r, idx) => {
    const src = state.studentResults[idx] || {};
    const nameDisplay = (r.nama === 'Tanpa Nama' && src._fileHint)
      ? `Tanpa Nama <span class="hint">(file: ${escapeHtml(src._fileHint)})</span>`
      : escapeHtml(r.nama || 'Tanpa Nama');

    const pg = r.pg;
    const essay = r.essay;

    let detailHtml = '';

    if (pg && pg.items && pg.items.length) {
      detailHtml += `
        <div class="detail-section">
          <div class="detail-section-title">📌 Pilihan Ganda — Benar ${pg.benar}/${pg.total} (${pg.persen}%)</div>
          <div class="detail-table">
            <div class="detail-row detail-head">
              <span>No</span><span>Soal</span><span>Kunci</span><span>Jawaban Siswa</span><span>Nilai</span>
            </div>
            ${pg.items.map(it => {
              const kp = resolveKunciParts(it);
              return `
              <div class="detail-row">
                <span class="qa-num">${escapeHtml(String(it.nomor))}</span>
                <span class="soal-cell">
                  <button type="button" class="btn-link btn-toggle-soal">Lihat soal</button>
                  <span class="soal-text hidden" dir="auto">${escapeHtml(resolveSoalText(it))}</span>
                </span>
                <span class="kunci-cell">
                  <button type="button" class="btn-link btn-toggle-kunci" title="Lihat teks kunci">${escapeHtml(kp.short)}</button>
                  <span class="kunci-text hidden" dir="auto">${escapeHtml(kp.full)}</span>
                </span>
                <span class="${it.benar ? 'qa-correct' : 'qa-wrong'}" dir="auto">${escapeHtml(String(it.siswa || '-'))}</span>
                <span class="${it.benar ? 'qa-correct' : 'qa-wrong'}">${it.benar ? '✓' : '✗'} ${it.skor ?? (it.benar ? 100 : 0)}</span>
              </div>`;
            }).join('')}
          </div>
        </div>`;
    }

    if (essay && essay.items && essay.items.length) {
      detailHtml += `
        <div class="detail-section">
          <div class="detail-section-title">📝 Essay — Skor ${essay.skor_total}/${essay.skor_maks} (${essay.persen}%)</div>
          <div class="detail-table essay-table">
            <div class="detail-row detail-head">
              <span>No</span><span>Soal</span><span>Kunci / Kriteria</span><span>Jawaban Siswa</span><span>Nilai</span>
            </div>
            ${essay.items.map(it => `
              <div class="detail-row">
                <span class="qa-num">${escapeHtml(String(it.nomor))}</span>
                <span class="soal-cell">
                  <button type="button" class="btn-link btn-toggle-soal">Lihat soal</button>
                  <span class="soal-text hidden" dir="auto">${escapeHtml(resolveSoalText(it))}</span>
                </span>
                <span dir="auto">${escapeHtml(String(it.kunci || '-'))}</span>
                <span dir="auto">${escapeHtml(String(it.siswa || '-'))}</span>
                <span class="${(it.skor || 0) >= 60 ? 'qa-correct' : 'qa-wrong'}">${it.skor ?? 0}</span>
              </div>
            `).join('')}
          </div>
        </div>`;
    }

    if (!detailHtml && r.details && r.details.length) {
      detailHtml = `<div class="detail-section"><div class="detail-table">
        ${r.details.map(d => `<div class="detail-row">
          <span>${escapeHtml(String(d.nomor))}</span>
          <span></span>
          <span>${escapeHtml(String(d.kunci || '-'))}</span>
          <span class="${d.benar ? 'qa-correct' : 'qa-wrong'}">${escapeHtml(String(d.siswa || '-'))}</span>
          <span>${d.benar ? '✓' : '✗'}</span>
        </div>`).join('')}
      </div></div>`;
    }

    return `
      <div class="result-item" data-idx="${idx}">
        <div class="result-header score-table-row">
          <span class="col-no">${idx + 1}</span>
          <span class="col-name result-name">${nameDisplay}${r.kelas ? ` <span class="hint">• ${escapeHtml(r.kelas)}</span>` : ''}</span>
          <span class="col-score result-score">${r.score}</span>
        </div>
        <div class="result-body">${detailHtml || '<p class="hint">Tidak ada detail butir.</p>'}</div>
      </div>`;
  }).join('');

  list.innerHTML = metaHtml + tableHead + rows + '</div>';

  list.querySelectorAll('.result-header').forEach(header => {
    header.addEventListener('click', (e) => {
      if (e.target.closest('.btn-toggle-soal') || e.target.closest('.btn-toggle-kunci')) return;
      header.parentElement.classList.toggle('open');
      onStudentNameClick();
    });
  });
  list.querySelectorAll('.btn-toggle-soal').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const text = btn.parentElement.querySelector('.soal-text');
      if (!text) return;
      text.classList.toggle('hidden');
      btn.textContent = text.classList.contains('hidden') ? 'Lihat soal' : 'Sembunyikan soal';
    });
  });
  list.querySelectorAll('.btn-toggle-kunci').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const box = btn.parentElement.querySelector('.kunci-text');
      if (!box) return;
      box.classList.toggle('hidden');
      // biarkan label huruf tetap; teks kunci muncul di bawah
    });
  });
}

let studentClickCount = 0;

function scheduleFeedbackModal() {
  studentClickCount = 0;
  const modal = $('#feedback-modal');
  if (!modal) return;
  // Selalu siapkan dock; form penuh hanya jika belum submit
  modal.classList.remove('hidden');
  if (sessionStorage.getItem('sh_feedback_submitted')) {
    modal.classList.remove('feedback-full');
    modal.classList.add('feedback-mini');
    return;
  }
  setTimeout(() => {
    modal.classList.remove('hidden', 'feedback-mini');
    modal.classList.add('feedback-full');
    setTimeout(() => shrinkFeedbackModal(), 2000);
  }, 3000);
}

function shrinkFeedbackModal() {
  const modal = $('#feedback-modal');
  if (!modal) return;
  // Setelah submit komentar: tetap floating mini, jangan hilang total
  modal.classList.remove('hidden', 'feedback-full');
  modal.classList.add('feedback-mini');
}

function expandFeedbackModal() {
  const modal = $('#feedback-modal');
  if (!modal) return;
  modal.classList.remove('hidden', 'feedback-mini');
  modal.classList.add('feedback-full');
}

function onStudentNameClick() {
  studentClickCount++;
  if (studentClickCount >= 2) {
    expandFeedbackModal();
  }
}

async function submitTestimonial(name, comment, liked) {
  const payload = {
    name: name || 'Anonim',
    comment: comment || '',
    liked: !!liked,
    created_at: new Date().toISOString()
  };
  // Coba Supabase
  try {
    const { getSupabase } = await import('./supabase.js');
    const sb = getSupabase();
    if (sb) {
      const { error } = await sb.from('testimonials').insert([payload]);
      if (!error) return true;
      console.warn('testimonial insert', error);
    }
  } catch (e) {
    console.warn(e);
  }
  // Fallback localStorage list (tampil di browser ini saja jika DB gagal)
  try {
    const list = JSON.parse(localStorage.getItem('sh_testimonials') || '[]');
    list.unshift(payload);
    localStorage.setItem('sh_testimonials', JSON.stringify(list.slice(0, 50)));
  } catch (_) {}
  return false;
}

async function loadTestimonials() {
  const box = $('#testimonials-list');
  if (!box) return;
  let rows = [];
  try {
    const { getSupabase } = await import('./supabase.js');
    const sb = getSupabase();
    if (sb) {
      const { data } = await sb.from('testimonials').select('*').order('created_at', { ascending: false }).limit(30);
      if (data) rows = data;
    }
  } catch (_) {}
  if (!rows.length) {
    try { rows = JSON.parse(localStorage.getItem('sh_testimonials') || '[]'); } catch (_) { rows = []; }
  }
  if (!rows.length) {
    box.innerHTML = '<p class="hint">Belum ada testimoni. Jadilah yang pertama!</p>';
    return;
  }
  box.innerHTML = rows.map(t => {
    const nm = t.name || 'Anonim';
    const initial = (nm.trim()[0] || '?').toUpperCase();
    return `
    <div class="testimonial-item">
      <div class="testimonial-avatar">${escapeHtml(initial)}</div>
      <div class="testimonial-head">
        <strong>${escapeHtml(nm)}</strong>
        <span class="hint">${t.created_at ? new Date(t.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}</span>
      </div>
      <p>“${escapeHtml(t.comment || 'Suka aplikasi ini 👍')}”</p>
    </div>`;
  }).join('');
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
