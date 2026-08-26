import { getCurrentFutId } from './futs.js';
import { SUPABASE_ANON_KEY, functionsUrl, getAccessToken } from '../supabase.js';

function apiErrorMessage(data, fallback) {
  return data?.error || data?.message || fallback;
}

async function adminFunctionPost(name, body) {
  const token = await getAccessToken();
  if (!token) throw new Error('Sessão expirada. Use Ajustes → Sair da conta e entre novamente.');
  const res = await fetch(functionsUrl(name), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(apiErrorMessage(data, `Falha em ${name}`));
  return data;
}

export async function importBackupJson(payload) {
  const futId = getCurrentFutId();
  if (!futId) throw new Error('Nenhum fut ativo');
  return adminFunctionPost('import-backup', { ...payload, futId });
}

export async function exportBackupJson() {
  const futId = getCurrentFutId();
  if (!futId) throw new Error('Nenhum fut ativo');
  return adminFunctionPost('export-backup', { futId });
}

export async function submitAvaliacao(payload) {
  const res = await fetch(functionsUrl('submit-avaliacao'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Falha ao enviar avaliação');
  return data;
}
