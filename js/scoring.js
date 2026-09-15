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

function isAnswerMatch(siswa, kunci) {
  if (!siswa || !kunci) return false;
  const s = normalizeAnswer(siswa);
  const k = normalizeAnswer(kunci);
  if (s === k) return true;

  // Essay sederhana: cek substring / similarity kasar
  const sLower = String(siswa).toLowerCase();
  const kLower = String(kunci).toLowerCase();
  if (sLower.includes(kLower) || kLower.includes(sLower)) return true;

  // Simple word overlap
  const sWords = new Set(sLower.split(/\s+/).filter(w => w.length > 2));
  const kWords = kLower.split(/\s+/).filter(w => w.length > 2);
  const overlap = kWords.filter(w => sWords.has(w)).length;
  if (kWords.length > 0 && overlap / kWords.length >= 0.6) return true;

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
