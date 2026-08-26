import { supabase } from '../supabase.js';

export async function currentSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function login(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  if (data.user?.app_metadata?.role !== 'admin') {
    await supabase.auth.signOut();
    throw new Error('Esta conta não tem permissão de administrador.');
  }
  return data.session;
}

export async function logout() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export function isAdminSession(session) {
  return session?.user?.app_metadata?.role === 'admin';
}

