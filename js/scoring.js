/**
 * Scoring logic
 */

/**
 * Normalisasi jawaban untuk perbandingan (PG)
 */
function normalizeAnswer(ans) {
  if (!ans) return '';
  return String(ans).trim().toUpperCase().replace(/[^A-E0-9]/g, '').charAt(0) || String(ans).trim().toLowerCase();
}

/**
 * Bandingkan jawaban siswa vs kunci
 * @returns {Object} { score, max, details[] }
 */
export function scoreStudent(studentData, keyData, onlineKey = null) {
  const details = [];
  let correct = 0;
  let total = 0;

  const keyMap = new Map();
  (keyData.jawaban || []).forEach(j => {
    keyMap.set(Number(j.nomor), j.jawaban);
  });

  // Jika onlineKey ada dan lebih lengkap, merge
  if (onlineKey && onlineKey.jawaban) {
    onlineKey.jawaban.forEach(j => {
      if (!keyMap.has(Number(j.nomor))) {
        keyMap.set(Number(j.nomor), j.jawaban);
      }
    });
  }

  const studentAnswers = studentData.jawaban || [];
  total = Math.max(studentAnswers.length, keyMap.size) || 1;

  studentAnswers.forEach(sa => {
    const nomor = Number(sa.nomor);
    const siswa = sa.jawaban;
    const kunci = keyMap.get(nomor) || '';
    const isCorrect = isAnswerMatch(siswa, kunci);

    if (isCorrect) correct++;

    details.push({
      nomor,
      siswa,
      kunci,
      benar: isCorrect,
      tipe: (siswa && siswa.length > 3) ? 'essay' : 'pg'
    });
  });

  // Soal di kunci yang tidak dijawab siswa
  keyMap.forEach((kunci, nomor) => {
    if (!details.find(d => d.nomor === nomor)) {
      details.push({
        nomor,
        siswa: '-',
        kunci,
        benar: false,
        tipe: 'pg'
      });
    }
  });

  details.sort((a, b) => a.nomor - b.nomor);

  const score = total > 0 ? Math.round((correct / total) * 100) : 0;

  return {
    nama: studentData.nama || 'Tanpa Nama',
    kelas: studentData.kelas || '',
    score,
    correct,
    total,
    details
  };
}

function normalizeArabic(text) {
  if (!text) return '';
  return String(text)
    .replace(/[\u064B-\u065F\u0670]/g, '') // hapus harakat
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[ـ\s]+/g, ' ')
    .trim();
}

function similarityRatio(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return 1;
  // Levenshtein sederhana
  const rows = shorter.length + 1;
  const cols = longer.length + 1;
  const dist = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i++) dist[i][0] = i;
  for (let j = 0; j < cols; j++) dist[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = shorter[i - 1] === longer[j - 1] ? 0 : 1;
      dist[i][j] = Math.min(
        dist[i - 1][j] + 1,
        dist[i][j - 1] + 1,
        dist[i - 1][j - 1] + cost
      );
    }
  }
  return 1 - dist[shorter.length][longer.length] / longer.length;
}

function isAnswerMatch(siswa, kunci) {
  if (!siswa || !kunci) return false;

  // PG Latin
  const s = normalizeAnswer(siswa);
  const k = normalizeAnswer(kunci);
  if (s && k && s === k && s.length <= 2) return true;

  // Essay / Imla Arab + Latin
  const sNorm = normalizeArabic(siswa).toLowerCase();
  const kNorm = normalizeArabic(kunci).toLowerCase();
  if (!sNorm || !kNorm) return false;
  if (sNorm === kNorm) return true;
  if (sNorm.includes(kNorm) || kNorm.includes(sNorm)) return true;

  // Similarity karakter (cocok untuk imla Arab yang mirip)
  const sim = similarityRatio(sNorm.replace(/\s/g, ''), kNorm.replace(/\s/g, ''));
  if (sim >= 0.72) return true;

  // Word overlap
  const sWords = new Set(sNorm.split(/\s+/).filter(w => w.length > 1));
  const kWords = kNorm.split(/\s+/).filter(w => w.length > 1);
  const overlap = kWords.filter(w => sWords.has(w)).length;
  if (kWords.length > 0 && overlap / kWords.length >= 0.55) return true;

  return false;
}

/**
 * Analisis butir soal sederhana
 */
export function analyzeItems(allResults) {
  if (!allResults || allResults.length === 0) return null;

  const itemMap = new Map(); // nomor → { correctCount, total, answers: [] }

  allResults.forEach(r => {
    (r.details || []).forEach(d => {
      if (!itemMap.has(d.nomor)) {
        itemMap.set(d.nomor, { correct: 0, total: 0, answers: [] });
      }
      const item = itemMap.get(d.nomor);
      item.total++;
      if (d.benar) item.correct++;
      item.answers.push(d.siswa);
    });
  });

  const items = [];
  itemMap.forEach((val, nomor) => {
    const p = val.total > 0 ? val.correct / val.total : 0; // tingkat kesukaran
    items.push({
      nomor,
      total_siswa: val.total,
      benar: val.correct,
      tingkat_kesukaran: Math.round(p * 100),
      kategori: p > 0.7 ? 'Mudah' : p > 0.3 ? 'Sedang' : 'Sulit'
    });
  });

  items.sort((a, b) => a.nomor - b.nomor);

  const avgScore = allResults.reduce((s, r) => s + r.score, 0) / allResults.length;

  return {
    jumlah_siswa: allResults.length,
    rata_rata: Math.round(avgScore),
    items
  };
}
