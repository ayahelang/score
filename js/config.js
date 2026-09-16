/**
 * Konfigurasi publik (aman di frontend).
 * Anon key memang didesain public. Gemini API Key TIDAK di sini —
 * disimpan sebagai secret Edge Function Supabase.
 */
export const APP_CONFIG = {
  supabaseUrl: 'https://lvvphyyoqekudwnffiyj.supabase.co',
  supabaseAnonKey: 'sb_publishable_C2g9OWG2OrTbCw_CpxrWMw_08E-C8lo',
  // Endpoint penilaian server-side
  gradeFunctionPath: '/functions/v1/grade'
};

export function gradeEndpoint() {
  return APP_CONFIG.supabaseUrl + APP_CONFIG.gradeFunctionPath;
}
