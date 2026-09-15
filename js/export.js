/**
 * Export PDF & Excel
 */

export function exportToPDF(results, meta = {}) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const pageW = doc.internal.pageSize.getWidth();
  let y = 18;

  // Header
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('Silverhawk Scoring – Hasil Penilaian', pageW / 2, y, { align: 'center' });
  y += 8;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  if (meta.school) { doc.text(`Sekolah: ${meta.school}`, 14, y); y += 5; }
  if (meta.class) { doc.text(`Kelas: ${meta.class}`, 14, y); y += 5; }
  if (meta.date) { doc.text(`Tanggal: ${meta.date}`, 14, y); y += 5; }
  if (meta.room) { doc.text(`Ruang/Mapel: ${meta.room}`, 14, y); y += 5; }
  y += 4;

  // Table
  const body = results.map((r, i) => [
    i + 1,
    r.nama,
    r.kelas || '-',
    `${r.correct}/${r.total}`,
    `${r.score}`
  ]);

  doc.autoTable({
    startY: y,
    head: [['No', 'Nama Siswa', 'Kelas', 'Benar', 'Nilai']],
    body,
    theme: 'striped',
    headStyles: { fillColor: [0, 180, 220], textColor: 20 },
    styles: { fontSize: 9, cellPadding: 2.5 },
    margin: { left: 14, right: 14 }
  });

  // Footer
  const finalY = doc.lastAutoTable.finalY + 10;
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(`Dicetak dari Silverhawk Scoring • ${new Date().toLocaleString('id-ID')}`, 14, finalY);
  doc.text('silverhawk.web.id', pageW - 14, finalY, { align: 'right' });

  doc.save(`Silverhawk_Hasil_${Date.now()}.pdf`);
}

export function exportToExcel(results, meta = {}) {
  const rows = results.map((r, i) => ({
    No: i + 1,
    Nama: r.nama,
    Kelas: r.kelas || '',
    Benar: r.correct,
    Total: r.total,
    Nilai: r.score
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Hasil');

  // Meta sheet
  const metaRows = [
    { Key: 'Sekolah', Value: meta.school || '' },
    { Key: 'Kelas', Value: meta.class || '' },
    { Key: 'Tanggal', Value: meta.date || '' },
    { Key: 'Ruang/Mapel', Value: meta.room || '' },
    { Key: 'Generated', Value: new Date().toISOString() }
  ];
  const wsMeta = XLSX.utils.json_to_sheet(metaRows);
  XLSX.utils.book_append_sheet(wb, wsMeta, 'Info');

  XLSX.writeFile(wb, `Silverhawk_Hasil_${Date.now()}.xlsx`);
}

export function exportAnalysisPDF(analysis) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  let y = 18;

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Analisis Butir Soal – Silverhawk Scoring', 14, y);
  y += 10;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Jumlah siswa: ${analysis.jumlah_siswa}`, 14, y); y += 5;
  doc.text(`Rata-rata nilai: ${analysis.rata_rata}`, 14, y); y += 8;

  const body = analysis.items.map(it => [
    it.nomor,
    it.total_siswa,
    it.benar,
    `${it.tingkat_kesukaran}%`,
    it.kategori
  ]);

  doc.autoTable({
    startY: y,
    head: [['No Soal', 'N Siswa', 'Benar', 'Kesukaran', 'Kategori']],
    body,
    theme: 'grid',
    headStyles: { fillColor: [0, 180, 220] },
    styles: { fontSize: 9 }
  });

  doc.save(`Silverhawk_Analisis_${Date.now()}.pdf`);
}
