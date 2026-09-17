/**
 * Langganan, voucher, panel admin
 */
import { getSupabase } from './supabase.js';

export const PACKAGES = {
  p1: {
    code: 'p1',
    name: 'Paket 1',
    price: 30000,
    days: 15,
    features: [
      'Simpan data & hasil 15 hari',
      'Akses admin SilverhawkCBT 15 hari (cbt.silverhawk.web.id)',
      'Generate Soal A4 PDF (25 PG + 5 Essay) + kunci'
    ]
  },
  p2: {
    code: 'p2',
    name: 'Paket 2',
    price: 55000,
    days: 30,
    features: [
      'Simpan data & hasil 30 hari',
      'Akses admin SilverhawkCBT 30 hari (cbt.silverhawk.web.id)',
      'Generate Soal A4 PDF (25 PG + 5 Essay) + kunci'
    ]
  }
};

export const ADMIN_EMAIL = 'admin@silverhawk.web.id';
export const WA_TEDDY = '6285158822803';

export function isAdminEmail(email) {
  return (email || '').toLowerCase() === ADMIN_EMAIL;
}

export function isSubscriptionActive(profile) {
  if (!profile?.package_code || !profile?.package_expires_at) return false;
  return new Date(profile.package_expires_at) > new Date();
}

export function daysLeft(profile) {
  if (!isSubscriptionActive(profile)) return 0;
  const ms = new Date(profile.package_expires_at) - new Date();
  return Math.max(0, Math.ceil(ms / 86400000));
}

export function subscribeWhatsAppUrl(pkgCode, userName) {
  const pkg = PACKAGES[pkgCode] || PACKAGES.p1;
  const name = userName || 'NAMA_SESUAI_AKUN_GOOGLE';
  const text =
    `Pak Teddy saya ingin berlangganan ${pkg.name} aplikasi Silverhawk Scoring,\n` +
    `Nama Saya adalah ${name}, dan ini saya attach bukti transfer saya ke Gopay/Dana Bapak. ` +
    `Tolong segera kirim voucher aksesnya ya Pak.`;
  return `https://wa.me/${WA_TEDDY}?text=${encodeURIComponent(text)}`;
}

export function voucherWhatsAppMessage(voucherCode, pkgCode, waTarget) {
  const pkg = PACKAGES[pkgCode] || PACKAGES.p1;
  const feats = pkg.features.map(f => '• ' + f).join('\n');
  const text =
    `Halo! Voucher Silverhawk Scoring Anda:\n\n` +
    `Kode: *${voucherCode}*\n` +
    `Paket: ${pkg.name} (${pkg.days} hari sejak diaktifkan)\n\n` +
    `Fitur:\n${feats}\n\n` +
    `Aktifkan di: https://score.silverhawk.web.id\n` +
    `(Login Google → Profil → Gunakan Voucher)`;
  const phone = String(waTarget || '').replace(/\D/g, '');
  return { text, url: phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : null };
}

export function generateVoucherCode(pkgCode) {
  const r = Math.random().toString(36).slice(2, 6).toUpperCase();
  const r2 = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `SH-${(pkgCode || 'p1').toUpperCase()}-${r}${r2}`;
}

export async function ensureProfile(user) {
  const sb = getSupabase();
  if (!sb || !user) return null;
  const { data: existing } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (existing) {
    // promote admin
    if (isAdminEmail(user.email) && !existing.is_admin) {
      await sb.from('profiles').update({ is_admin: true, email: user.email }).eq('id', user.id);
      existing.is_admin = true;
    }
    return existing;
  }
  const row = {
    id: user.id,
    email: user.email,
    full_name: user.user_metadata?.full_name || user.user_metadata?.name || '',
    avatar_url: user.user_metadata?.avatar_url || user.user_metadata?.picture || '',
    is_admin: isAdminEmail(user.email)
  };
  const { data, error } = await sb.from('profiles').upsert(row).select().single();
  if (error) {
    console.warn('ensureProfile', error);
    return row;
  }
  return data;
}

export async function saveWaNumber(userId, wa) {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from('profiles').update({ wa_number: wa, updated_at: new Date().toISOString() }).eq('id', userId);
}

export async function redeemVoucher(user, code) {
  const sb = getSupabase();
  if (!sb || !user) throw new Error('Login dulu');
  const c = (code || '').trim().toUpperCase();
  if (!c) throw new Error('Kode kosong');

  const { data: v, error } = await sb.from('vouchers').select('*').eq('code', c).maybeSingle();
  if (error) throw error;
  if (!v) throw new Error('Voucher tidak ditemukan');
  if (v.used_by) throw new Error('Voucher sudah digunakan');
  if (v.target_user_id && v.target_user_id !== user.id) {
    throw new Error('Voucher ini hanya untuk akun Google lain');
  }
  if (v.target_email && v.target_email.toLowerCase() !== (user.email || '').toLowerCase()) {
    throw new Error('Voucher tidak cocok dengan email akun Anda');
  }

  const pkg = PACKAGES[v.package_code] || PACKAGES.p1;
  const expires = new Date();
  expires.setDate(expires.getDate() + (v.days || pkg.days));

  const { error: e1 } = await sb.from('vouchers').update({
    used_by: user.id,
    used_at: new Date().toISOString()
  }).eq('id', v.id).is('used_by', null);
  if (e1) throw e1;

  const { error: e2 } = await sb.from('profiles').update({
    package_code: v.package_code,
    package_expires_at: expires.toISOString(),
    updated_at: new Date().toISOString()
  }).eq('id', user.id);
  if (e2) throw e2;

  return { package_code: v.package_code, package_expires_at: expires.toISOString(), days: v.days || pkg.days };
}

export async function listProfilesForAdmin() {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb.from('profiles').select('*').order('created_at', { ascending: false }).limit(100);
  if (error) {
    console.warn(error);
    return [];
  }
  return data || [];
}

export async function createVoucherForUser(adminUser, targetProfile, packageCode) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase offline');
  const pkg = PACKAGES[packageCode] || PACKAGES.p1;
  const code = generateVoucherCode(packageCode);
  const row = {
    code,
    package_code: pkg.code,
    target_user_id: targetProfile.id,
    target_email: targetProfile.email,
    days: pkg.days,
    created_by: adminUser.id,
    notes: `Generated for ${targetProfile.email}`
  };
  const { data, error } = await sb.from('vouchers').insert(row).select().single();
  if (error) throw error;
  return data;
}
