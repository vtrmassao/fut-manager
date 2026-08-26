import { supabase } from '../supabase.js';

/** @type {{ futId: string, configId: string, adminPlayerId: string, futNome: string } | null} */
let activeFutMeta = null;

function storageKey(userId) {
  return `futmgr_v2_fut_${userId}`;
}

export function getActiveFutMeta() {
  return activeFutMeta;
}

export function getCurrentFutId() {
  return activeFutMeta?.futId || null;
}

export function setActiveFutMeta(meta) {
  activeFutMeta = meta;
}

export async function listMyFuts() {
  const { data, error } = await supabase
    .from('futs')
    .select('id, nome, created_at')
    .order('created_at');
  if (error) throw error;
  return data || [];
}

export async function createFut(nome) {
  const trimmed = String(nome || '').trim();
  if (!trimmed) throw new Error('Nome do fut é obrigatório');

  const { data, error } = await supabase.rpc('create_fut', { p_nome: trimmed });
  if (error) throw error;

  const meta = {
    futId: data.futId,
    configId: data.configId,
    adminPlayerId: data.adminPlayerId,
    futNome: data.nome,
  };
  return meta;
}

export async function deleteFut(futId) {
  if (!futId) throw new Error('Fut não informado');
  const { error } = await supabase.from('futs').delete().eq('id', futId);
  if (error) throw error;
}

async function loadFutMeta(futId) {
  const futs = await listMyFuts();
  const fut = futs.find((f) => f.id === futId);
  if (!fut) throw new Error('Fut não encontrado');

  const [
    { data: cfg, error: cErr },
    { data: admin, error: aErr },
  ] = await Promise.all([
    supabase.from('config').select('id').eq('fut_id', futId).maybeSingle(),
    supabase.from('jogadores').select('id').eq('fut_id', futId).eq('tipo', 'admin').maybeSingle(),
  ]);
  if (cErr) throw cErr;
  if (aErr) throw aErr;
  if (!cfg || !admin) throw new Error('Fut incompleto (config ou admin ausente)');

  return {
    futId: fut.id,
    configId: cfg.id,
    adminPlayerId: admin.id,
    futNome: fut.nome,
  };
}

export async function activateFut(futId, userId) {
  const meta = await loadFutMeta(futId);
  setActiveFutMeta(meta);
  if (userId) localStorage.setItem(storageKey(userId), futId);
  return meta;
}

function showFutModal(title, futs, { allowCancel = false } = {}) {
  return new Promise((resolve, reject) => {
    const ov = document.createElement('div');
    ov.id = 'fut-modal-overlay';
    ov.className = 'confirm-overlay';
    ov.style.zIndex = '10001';

    const optionsHtml = futs.length
      ? futs.map((f) => `<option value="${f.id}">${f.nome}</option>`).join('')
      : '';

    ov.innerHTML = `
      <div class="confirm-box" style="max-width:360px" role="dialog" aria-modal="true">
        <div class="hist-title" style="margin-bottom:12px">${title}</div>
        ${futs.length ? `
          <label style="font-family:DM Sans,sans-serif;font-size:0.85rem;color:#888;display:block;margin-bottom:6px">Selecionar fut</label>
          <select id="fut-modal-select" class="fut-input" style="width:100%;margin-bottom:10px;flex:none">${optionsHtml}</select>
        ` : ''}
        <label style="font-family:DM Sans,sans-serif;font-size:0.85rem;color:#888;display:block;margin-bottom:6px">${futs.length ? 'Ou criar novo' : 'Nome do fut'}</label>
        <input type="text" id="fut-modal-nome" class="fut-input" placeholder="Ex.: Quarta-feira" style="width:100%;margin-bottom:12px;flex:none">
        <p id="fut-modal-error" style="font-family:DM Sans,sans-serif;color:#ff5252;font-size:0.8rem;display:none;margin-bottom:8px"></p>
        <div class="confirm-actions" style="flex-wrap:wrap;gap:8px">
          ${allowCancel ? '<button type="button" class="confirm-cancel" id="fut-modal-cancel">Cancelar</button>' : ''}
          ${futs.length ? '<button type="button" class="btn-add" id="fut-modal-use" style="flex:1">Usar selecionado</button>' : ''}
          <button type="button" class="btn-add" id="fut-modal-create" style="flex:1;background:#1565c0;color:#fff">${futs.length ? 'Criar novo' : 'Criar fut'}</button>
        </div>
      </div>`;

    document.body.appendChild(ov);

    const errEl = ov.querySelector('#fut-modal-error');
    const nomeEl = ov.querySelector('#fut-modal-nome');
    const selectEl = ov.querySelector('#fut-modal-select');

    function cleanup() {
      ov.remove();
    }

    function showErr(msg) {
      if (errEl) {
        errEl.style.display = '';
        errEl.textContent = msg;
      }
    }

    ov.querySelector('#fut-modal-cancel')?.addEventListener('click', () => {
      cleanup();
      reject(new Error('cancelled'));
    });

    ov.querySelector('#fut-modal-use')?.addEventListener('click', () => {
      const id = selectEl?.value;
      if (!id) { showErr('Selecione um fut'); return; }
      cleanup();
      resolve({ action: 'select', futId: id });
    });

    ov.addEventListener('click', (e) => {
      if (e.target === ov && allowCancel) {
        cleanup();
        reject(new Error('cancelled'));
      }
    });

    ov.querySelector('#fut-modal-create')?.addEventListener('click', async () => {
      const nome = nomeEl?.value?.trim();
      if (!nome) { showErr('Informe o nome do fut'); return; }
      try {
        const meta = await createFut(nome);
        cleanup();
        resolve({ action: 'create', meta });
      } catch (e) {
        showErr(e.message || String(e));
      }
    });

    nomeEl?.focus();
  });
}

/**
 * Garante fut ativo após login admin.
 * @returns {Promise<{ futId: string, configId: string, adminPlayerId: string, futNome: string }>}
 */
export async function ensureActiveFut(session) {
  const userId = session.user.id;
  const futs = await listMyFuts();

  if (futs.length === 0) {
    const result = await showFutModal('Criar seu primeiro fut', [], { allowCancel: false });
    if (result.action === 'create') {
      setActiveFutMeta(result.meta);
      localStorage.setItem(storageKey(userId), result.meta.futId);
      return result.meta;
    }
  }

  const savedId = localStorage.getItem(storageKey(userId));
  if (savedId && futs.some((f) => f.id === savedId)) {
    return activateFut(savedId, userId);
  }

  if (futs.length === 1) {
    return activateFut(futs[0].id, userId);
  }

  const result = await showFutModal('Escolher fut', futs, { allowCancel: false });
  if (result.action === 'select') {
    return activateFut(result.futId, userId);
  }
  if (result.action === 'create') {
    setActiveFutMeta(result.meta);
    localStorage.setItem(storageKey(userId), result.meta.futId);
    return result.meta;
  }

  throw new Error('Não foi possível selecionar um fut');
}

export async function switchFut(futId, userId) {
  return activateFut(futId, userId);
}

export async function promptCreateFut() {
  const futs = await listMyFuts();
  const result = await showFutModal('Novo fut', futs, { allowCancel: true });
  if (result.action === 'create') return result.meta;
  if (result.action === 'select') {
    const { data: { session } } = await supabase.auth.getSession();
    return activateFut(result.futId, session?.user?.id);
  }
  return null;
}
