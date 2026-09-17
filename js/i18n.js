/** i18n: id, en, ar, fr */
const STRINGS = {
  id: {
    tagline: 'Pemeriksa Lembar Jawaban bertenaga AI',
    login: 'Login / Daftar',
    logout: 'Keluar',
    keyTitle: 'Kunci Jawaban',
    studentTitle: 'Lembar Jawaban Siswa',
    start: 'Mulai penilaian AI',
    reset: 'Reset upload',
    customPrompt: 'Instruksi tambahan (opsional)',
    metaTitle: 'Informasi Ujian (opsional)',
    school: 'Nama Sekolah',
    class: 'Kelas',
    date: 'Tanggal Ujian',
    room: 'Ruang / Mapel',
    results: 'Hasil Penilaian',
    exportPdf: 'PDF',
    exportExcel: 'Excel',
    needFeedback: 'Isi nama & komentar dulu sebelum mengunduh hasil.',
    subscribe: 'Berlangganan',
    packages: 'Paket Langganan',
    voucher: 'Kode Voucher',
    useVoucher: 'Gunakan Voucher',
    profile: 'Profil saya',
    admin: 'Panel Admin',
    wa: 'Nomor WhatsApp',
    save: 'Simpan',
    pkg1: 'Paket 1 — Rp 30.000',
    pkg2: 'Paket 2 — Rp 55.000',
    days15: '15 hari',
    days30: '30 hari',
    genSoal: 'Generate Soal A4 PDF',
    lang: 'Bahasa',
    processing: 'Sedang memproses...',
    done: 'Selesai!',
  },
  en: {
    tagline: 'AI-Powered Answer Sheet Checker',
    login: 'Login / Sign up',
    logout: 'Sign out',
    keyTitle: 'Answer Key',
    studentTitle: 'Student Sheets',
    start: 'Start AI scoring',
    reset: 'Reset uploads',
    customPrompt: 'Extra instructions (optional)',
    metaTitle: 'Exam info (optional)',
    school: 'School name',
    class: 'Class',
    date: 'Exam date',
    room: 'Room / Subject',
    results: 'Scoring Results',
    exportPdf: 'PDF',
    exportExcel: 'Excel',
    needFeedback: 'Please enter your name & comment before downloading.',
    subscribe: 'Subscribe',
    packages: 'Subscription plans',
    voucher: 'Voucher code',
    useVoucher: 'Redeem voucher',
    profile: 'My profile',
    admin: 'Admin panel',
    wa: 'WhatsApp number',
    save: 'Save',
    pkg1: 'Plan 1 — Rp 30,000',
    pkg2: 'Plan 2 — Rp 55,000',
    days15: '15 days',
    days30: '30 days',
    genSoal: 'Generate A4 exam PDF',
    lang: 'Language',
    processing: 'Processing...',
    done: 'Done!',
  },
  ar: {
    tagline: 'مصحح أوراق الإجابة بالذكاء الاصطناعي',
    login: 'تسجيل الدخول / إنشاء حساب',
    logout: 'تسجيل الخروج',
    keyTitle: 'مفتاح الإجابة',
    studentTitle: 'أوراق إجابات الطلاب',
    start: 'بدء التصحيح بالذكاء الاصطناعي',
    reset: 'إعادة التعيين',
    customPrompt: 'تعليمات إضافية (اختياري)',
    metaTitle: 'معلومات الاختبار (اختياري)',
    school: 'اسم المدرسة',
    class: 'الصف',
    date: 'تاريخ الاختبار',
    room: 'القاعة / المادة',
    results: 'نتائج التصحيح',
    exportPdf: 'PDF',
    exportExcel: 'Excel',
    needFeedback: 'يرجى إدخال الاسم والتعليق قبل التحميل.',
    subscribe: 'الاشتراك',
    packages: 'باقات الاشتراك',
    voucher: 'رمز القسيمة',
    useVoucher: 'استخدام القسيمة',
    profile: 'ملفي',
    admin: 'لوحة الإدارة',
    wa: 'رقم واتساب',
    save: 'حفظ',
    pkg1: 'الباقة 1 — 30 ألف روبية',
    pkg2: 'الباقة 2 — 55 ألف روبية',
    days15: '15 يومًا',
    days30: '30 يومًا',
    genSoal: 'إنشاء اختبار PDF A4',
    lang: 'اللغة',
    processing: 'جاري المعالجة...',
    done: 'تم!',
  },
  fr: {
    tagline: 'Correcteur de copies propulsé par l’IA',
    login: 'Connexion / Inscription',
    logout: 'Déconnexion',
    keyTitle: 'Corrigé',
    studentTitle: 'Copies des élèves',
    start: 'Lancer la correction IA',
    reset: 'Réinitialiser',
    customPrompt: 'Instructions supplémentaires (optionnel)',
    metaTitle: 'Infos examen (optionnel)',
    school: 'École',
    class: 'Classe',
    date: 'Date',
    room: 'Salle / Matière',
    results: 'Résultats',
    exportPdf: 'PDF',
    exportExcel: 'Excel',
    needFeedback: 'Indiquez votre nom et un commentaire avant le téléchargement.',
    subscribe: 'S’abonner',
    packages: 'Formules d’abonnement',
    voucher: 'Code voucher',
    useVoucher: 'Utiliser le voucher',
    profile: 'Mon profil',
    admin: 'Panneau admin',
    wa: 'Numéro WhatsApp',
    save: 'Enregistrer',
    pkg1: 'Offre 1 — 30 000 Rp',
    pkg2: 'Offre 2 — 55 000 Rp',
    days15: '15 jours',
    days30: '30 jours',
    genSoal: 'Générer sujet PDF A4',
    lang: 'Langue',
    processing: 'Traitement...',
    done: 'Terminé !',
  }
};

let currentLang = localStorage.getItem('sh_lang') || 'id';

export function t(key) {
  return (STRINGS[currentLang] && STRINGS[currentLang][key]) || STRINGS.id[key] || key;
}

export function getLang() {
  return currentLang;
}

export function setLang(lang) {
  if (!STRINGS[lang]) return;
  currentLang = lang;
  localStorage.setItem('sh_lang', lang);
  document.documentElement.lang = lang === 'ar' ? 'ar' : lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  applyI18n();
}

export function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const k = el.getAttribute('data-i18n');
    if (k && t(k)) el.textContent = t(k);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const k = el.getAttribute('data-i18n-placeholder');
    if (k && t(k)) el.placeholder = t(k);
  });
  const tag = document.querySelector('.logo-text p');
  if (tag) tag.textContent = t('tagline');
}
