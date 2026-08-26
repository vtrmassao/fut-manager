import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export const SUPABASE_URL = 'https://lajdoswgtgcuazviewgb.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhamRvc3dndGdjdWF6dmlld2diIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2MjU4NzEsImV4cCI6MjEwMzIwMTg3MX0.tjq57D1kcSmN2WSfUdDYr88PjnqYwSNRpo6Tro2dsIE';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export function functionsUrl(name) {
  return `${SUPABASE_URL}/functions/v1/${name}`;
}

export async function getAccessToken() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || null;
}

export async function requireAdminSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;
  const role = session.user.app_metadata?.role;
  if (role !== 'admin') {
    await supabase.auth.signOut();
    return null;
  }
  return session;
}
