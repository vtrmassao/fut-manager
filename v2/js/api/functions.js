import { supabase } from '../supabase.js';

export async function submitAvaliacao(payload) {
  const { data, error } = await supabase.functions.invoke('submit-avaliacao', { body: payload });
  if (error) throw error;
  return data;
}

export async function exportBackup() {
  const { data, error } = await supabase.functions.invoke('export-backup', { method: 'POST' });
  if (error) throw error;
  return data;
}

export async function importBackup(payload) {
  const { data, error } = await supabase.functions.invoke('import-backup', { body: payload });
  if (error) throw error;
  return data;
}

