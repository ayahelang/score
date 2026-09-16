// Supabase client helper
let supabaseClient = null;

export function initSupabase(url, anonKey) {
  if (!url || !anonKey) return null;
  try {
    supabaseClient = window.supabase.createClient(url, anonKey);
    return supabaseClient;
  } catch (e) {
    console.error('Supabase init error', e);
    return null;
  }
}

export function getSupabase() {
  return supabaseClient;
}

export async function signInWithGoogle() {
  if (!supabaseClient) throw new Error('Supabase belum dikonfigurasi');

  // Gunakan origin + path saat ini agar tidak redirect ke localhost
  const redirectTo = window.location.origin + (window.location.pathname || '/');
  console.log('OAuth redirectTo:', redirectTo);

  const { data, error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      queryParams: {
        access_type: 'offline',
        prompt: 'select_account'
      }
    }
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
}

export async function getSession() {
  if (!supabaseClient) return null;
  const { data: { session } } = await supabaseClient.auth.getSession();
  return session;
}

export function onAuthStateChange(callback) {
  if (!supabaseClient) return { data: { subscription: { unsubscribe: () => {} } } };
  return supabaseClient.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
}

// Storage helpers
export async function uploadFile(bucket, path, file) {
  if (!supabaseClient) return { error: 'No client' };
  const { data, error } = await supabaseClient.storage
    .from(bucket)
    .upload(path, file, { upsert: true });
  return { data, error };
}

export async function listFiles(bucket, prefix = '') {
  if (!supabaseClient) return { data: [], error: null };
  const { data, error } = await supabaseClient.storage.from(bucket).list(prefix);
  return { data, error };
}

// Simple insert for results (optional persistence)
export async function saveResult(payload) {
  if (!supabaseClient) return { error: 'No client' };
  const { data, error } = await supabaseClient
    .from('results')
    .insert([payload])
    .select();
  return { data, error };
}
