import { hydrateState, obterMesAnoAtual } from './api/hydrate.js';
import * as persist from './api/persist.js';
import { persistState } from './api/data.js';
import { exportBackupJson, importBackupJson, submitAvaliacao, fetchPartidaAvaliacao, approveAvaliacoes } from './api/backup.js';
import { logout } from './api/auth.js';
import { activateFut, deleteFut, ensureActiveFut, listMyFuts, promptCreateFut, setActiveFutMeta, switchFut } from './api/futs.js';
import { supabase } from './supabase.js';
import { jsArg, sameId } from './utils/ids.js';

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const DIAS_SEMANA = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const DIAS_SEMANA_CURTO = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

    function getAdmin() {
      return { id: state?.meta?.adminPlayerId, origem: 'admin' };
    }

    const DISCORD_WEBHOOK_PREFIX = 'https://discord.com/api/webhooks/';

    const ui = {
      partidaView: 'lista',
      partidaId: null,
      rankingFiltro: 'mensal',
      rankingPartidaId: null,
      draftData: null,
      draftHoraInicio: '21:00',
      draftHoraFim: '23:00',
      draftSelecionados: {},
      draftConvidados: []
    };

    /** Estado da tela #a= (não persiste). */
    const avaliarUi = {
      payload: null,
      avaliadorId: null,
      notas: {},
      stats: {},
      enviando: false
    };

    /** null / '?' = nível desconhecido (exibe ?). undefined/'' legado → 3. */
    function isNivelDesconhecido(n) {
      return n === null || n === '?';
    }

    function normalizeNivel(n) {
      if (isNivelDesconhecido(n)) return null;
      if (n === undefined || n === '') return 3;
      const v = Number(n);
      if (!v || isNaN(v)) return null;
      return Math.min(5, Math.max(1, Math.round(v)));
    }

    /** Valor numérico para sorteio/somas: desconhecido conta como 3 (médio). */
    function nivelParaSorteio(n) {
      const v = normalizeNivel(n);
      return v === null ? 3 : v;
    }

    function formatNivel(n) {
      if (isNivelDesconhecido(n)) return '?';
      const v = normalizeNivel(n);
      return v === null ? '?' : String(v);
    }

    function cycleNivelValue(n) {
      if (isNivelDesconhecido(n)) return 1;
      const v = normalizeNivel(n);
      if (v === null || v >= 5) return null;
      return v + 1;
    }

    /** Valor usado no sorteio: Nv manual ou Av (média das avaliações). Sem Av → cai no Nv. */
    function nivelParaBalanceamento(part) {
      if (!part) return 3;
      if (getBalanceamentoTimes() === 'avaliacao') {
        if (!isNivelDesconhecido(part.nivelAvaliacao) && part.nivelAvaliacao != null) {
          return nivelParaSorteio(part.nivelAvaliacao);
        }
      }
      return nivelParaSorteio(part.nivel);
    }

    function getBalanceamentoTimes() {
      return state.balanceamentoTimes === 'avaliacao' ? 'avaliacao' : 'nivel';
    }

    function setBalanceamentoTimes(mode) {
      state.balanceamentoTimes = mode === 'avaliacao' ? 'avaliacao' : 'nivel';
      save();
      render();
    }

    function labelBalanceamentoTimes() {
      return getBalanceamentoTimes() === 'avaliacao' ? 'Av' : 'Nv';
    }

    /** @deprecated use nivelParaSorteio / formatNivel / normalizeNivel */
    function clampNivel(n) {
      return nivelParaSorteio(n);
    }

    function getJogadoresPorTime() {
      const n = Number(state.jogadoresPorTime);
      if (!n || isNaN(n) || n < 1) return 5;
      return Math.min(11, Math.max(1, Math.round(n)));
    }

    function normalizeCadastroPlayer(p) {
      return {
        ...p,
        nivel: normalizeNivel(p.nivel !== undefined ? p.nivel : 3),
        nivelAvaliacao: p.nivelAvaliacao !== undefined ? normalizeNivel(p.nivelAvaliacao) : null,
        goleiro: !!p.goleiro
      };
    }

    function perfilFromParsed(parsed, part) {
      if (part.nivel !== undefined && part.goleiro !== undefined) {
        return {
          nivel: normalizeNivel(part.nivel),
          nivelAvaliacao: part.nivelAvaliacao !== undefined ? normalizeNivel(part.nivelAvaliacao) : null,
          goleiro: !!part.goleiro
        };
      }
      if (part.origem === 'admin' || part.playerId == getAdmin().id) {
        const ap = parsed.adminPerfil || {};
        return {
          nivel: normalizeNivel(ap.nivel !== undefined ? ap.nivel : 3),
          nivelAvaliacao: ap.nivelAvaliacao !== undefined ? normalizeNivel(ap.nivelAvaliacao) : null,
          goleiro: !!ap.goleiro
        };
      }
      if (part.origem === 'mensalista') {
        const m = (parsed.mensalistas || []).find(x => x.id == part.playerId);
        if (m) {
          return {
            nivel: normalizeNivel(m.nivel !== undefined ? m.nivel : 3),
            nivelAvaliacao: m.nivelAvaliacao !== undefined ? normalizeNivel(m.nivelAvaliacao) : null,
            goleiro: !!m.goleiro
          };
        }
      }
      if (part.origem === 'avulso') {
        const a = (parsed.avulsos || []).find(x => x.id == part.playerId);
        if (a) {
          return {
            nivel: normalizeNivel(a.nivel !== undefined ? a.nivel : 3),
            nivelAvaliacao: a.nivelAvaliacao !== undefined ? normalizeNivel(a.nivelAvaliacao) : null,
            goleiro: !!a.goleiro
          };
        }
      }
      return { nivel: 3, nivelAvaliacao: null, goleiro: false };
    }

    function migrateState(parsed) {
      if (parsed.valorMensalidade === undefined) parsed.valorMensalidade = 0;
      if (parsed.valorAvulso === undefined) parsed.valorAvulso = 0;
      if (parsed.mesAno === undefined) parsed.mesAno = obterMesAnoAtual();
      if (parsed.chavePix === undefined) parsed.chavePix = '';
      if (!Array.isArray(parsed.debitos)) {
        parsed.debitos = [];
      } else {
        parsed.debitos = parsed.debitos
          .filter(d => d && typeof d === 'object')
          .map(d => ({
            id: d.id || crypto.randomUUID(),
            descricao: typeof d.descricao === 'string' ? d.descricao : String(d.descricao || ''),
            valor: Math.max(0, +d.valor || 0)
          }));
      }
      // Total já aplicado no caixa (mutado no add/remove). Migração única a partir da lista legada.
      if (parsed.outrosDebitos === undefined || isNaN(+parsed.outrosDebitos)) {
        parsed.outrosDebitos = parsed.debitos.reduce((s, d) => s + (+d.valor || 0), 0);
      } else {
        parsed.outrosDebitos = Math.max(0, +parsed.outrosDebitos);
      }
      if (!Array.isArray(parsed.debitosHistorico)) {
        parsed.debitosHistorico = [];
      } else {
        parsed.debitosHistorico = parsed.debitosHistorico
          .filter(h => h && typeof h === 'object')
          .map(h => {
            const itens = Array.isArray(h.itens)
              ? h.itens.filter(d => d && typeof d === 'object').map(d => ({
                  id: d.id || crypto.randomUUID(),
                  descricao: typeof d.descricao === 'string' ? d.descricao : String(d.descricao || ''),
                  valor: Math.max(0, +d.valor || 0)
                }))
              : [];
            const total = itens.reduce((s, d) => s + (+d.valor || 0), 0);
            return {
              mesAno: typeof h.mesAno === 'string' ? h.mesAno : '',
              itens,
              total: h.total !== undefined && !isNaN(+h.total) ? Math.max(0, +h.total) : total
            };
          })
          .filter(h => h.itens.length > 0);
      }
      if (parsed.jogadoresPorTime === undefined || isNaN(+parsed.jogadoresPorTime) || +parsed.jogadoresPorTime < 1) {
        parsed.jogadoresPorTime = 5;
      } else {
        parsed.jogadoresPorTime = Math.min(11, Math.max(1, Math.round(+parsed.jogadoresPorTime)));
      }
      if (parsed.balanceamentoTimes !== 'avaliacao' && parsed.balanceamentoTimes !== 'nivel') {
        parsed.balanceamentoTimes = 'nivel';
      }
      if (parsed.peladaDiaSemana === undefined || isNaN(+parsed.peladaDiaSemana)) {
        parsed.peladaDiaSemana = 3;
      } else {
        parsed.peladaDiaSemana = Math.min(6, Math.max(0, Math.round(+parsed.peladaDiaSemana)));
      }
      if (typeof parsed.peladaHoraInicio !== 'string' || !normalizeHora(parsed.peladaHoraInicio)) {
        parsed.peladaHoraInicio = '21:00';
      } else {
        parsed.peladaHoraInicio = normalizeHora(parsed.peladaHoraInicio);
      }
      if (typeof parsed.peladaHoraFim !== 'string' || !normalizeHora(parsed.peladaHoraFim)) {
        parsed.peladaHoraFim = '23:00';
      } else {
        parsed.peladaHoraFim = normalizeHora(parsed.peladaHoraFim);
      }
      if (typeof parsed.peladaDataInicio !== 'string') parsed.peladaDataInicio = '';
      else if (parsed.peladaDataInicio && !/^\d{4}-\d{2}-\d{2}$/.test(parsed.peladaDataInicio)) {
        parsed.peladaDataInicio = brToISO(parsed.peladaDataInicio) || '';
      }
      if (!parsed.adminPerfil || typeof parsed.adminPerfil !== 'object') {
        parsed.adminPerfil = { nome: '', nivel: 3, nivelAvaliacao: null, goleiro: false };
      } else {
        parsed.adminPerfil = {
          nome: typeof parsed.adminPerfil.nome === 'string' ? parsed.adminPerfil.nome : '',
          nivel: normalizeNivel(parsed.adminPerfil.nivel !== undefined ? parsed.adminPerfil.nivel : 3),
          nivelAvaliacao: parsed.adminPerfil.nivelAvaliacao !== undefined
            ? normalizeNivel(parsed.adminPerfil.nivelAvaliacao)
            : null,
          goleiro: !!parsed.adminPerfil.goleiro
        };
      }
      parsed.mensalistas = (parsed.mensalistas || []).map(normalizeCadastroPlayer);
      parsed.avulsos = (parsed.avulsos || []).map(normalizeCadastroPlayer);
      if (!Array.isArray(parsed.partidas)) parsed.partidas = [];
      parsed.partidas = parsed.partidas.map(p => ({
        ...p,
        participantes: (p.participantes || []).map(part => {
          const origem = origemEfetivaParticipante(part, parsed);
          const partNorm = { ...part, origem };
          const perfil = perfilFromParsed(parsed, partNorm);
          return {
            gols: 0,
            assistencias: 0,
            defesas: 0,
            ...partNorm,
            origem,
            nivel: part.nivel !== undefined ? normalizeNivel(part.nivel) : perfil.nivel,
            nivelAvaliacao: part.nivelAvaliacao !== undefined
              ? normalizeNivel(part.nivelAvaliacao)
              : (perfil.nivelAvaliacao !== undefined ? normalizeNivel(perfil.nivelAvaliacao) : null),
            goleiro: part.goleiro !== undefined ? !!part.goleiro : perfil.goleiro
          };
        }),
        times: normalizeTimes(p.times)
      }));
      if (typeof parsed.discordWebhookUrl !== 'string') parsed.discordWebhookUrl = '';
      if (!Array.isArray(parsed.avaliacoes)) {
        parsed.avaliacoes = [];
      } else {
        parsed.avaliacoes = parsed.avaliacoes
          .map(normalizePacoteAvaliacaoMigracao)
          .filter(Boolean);
      }
      aplicarNivelAvaliacaoNoParsed(parsed);
      return parsed;
    }

    /** Atualiza só nivelAvaliacao a partir de avaliacoes aprovadas (não mexe no nivel manual). */
    function isAvaliacaoAprovada(av) {
      return !!(av && av.aprovadaEm);
    }

    function isAvaliacaoPendente(av) {
      return !!(av && !av.aprovadaEm && !av.rejeitadaEm);
    }

    function aplicarNivelAvaliacaoNoParsed(parsed) {
      const sums = {};
      (parsed.avaliacoes || []).forEach(av => {
        if (!isAvaliacaoAprovada(av)) return;
        Object.keys(av.notas || {}).forEach(k => {
          const n = +av.notas[k];
          if (isNaN(n)) return;
          if (!sums[k]) sums[k] = { sum: 0, count: 0 };
          sums[k].sum += n;
          sums[k].count++;
        });
      });
      function nivelAvDe(id) {
        if (id == null || id === '') return null;
        const s = sums[String(id)];
        if (!s || !s.count) return null;
        return Math.min(5, Math.max(1, Math.round(s.sum / s.count)));
      }
      if (!parsed.adminPerfil) parsed.adminPerfil = { nome: '', nivel: 3, nivelAvaliacao: null, goleiro: false };
      const adminId = parsed.meta?.adminPlayerId;
      parsed.adminPerfil.nivelAvaliacao = adminId ? nivelAvDe(adminId) : null;
      parsed.mensalistas = (parsed.mensalistas || []).map(m => ({
        ...m,
        nivelAvaliacao: nivelAvDe(m.id)
      }));
      parsed.avulsos = (parsed.avulsos || []).map(a => ({
        ...a,
        nivelAvaliacao: nivelAvDe(a.id)
      }));
      (parsed.partidas || []).forEach(p => {
        (p.participantes || []).forEach(part => {
          part.nivelAvaliacao = nivelAvDe(part.playerId);
        });
      });
    }

    function temNivelAvCadastrado() {
      if (!isNivelDesconhecido(getAdminPerfil().nivelAvaliacao)) return true;
      if ((state.mensalistas || []).some(m => !isNivelDesconhecido(m.nivelAvaliacao))) return true;
      if ((state.avulsos || []).some(a => !isNivelDesconhecido(a.nivelAvaliacao))) return true;
      return false;
    }

    function normalizePacoteAvaliacaoMigracao(av) {
      if (!av || typeof av !== 'object') return null;
      const partidaId = String(av.partidaId || '');
      const avaliadorId = String(av.avaliadorId || '');
      if (!partidaId || !avaliadorId) return null;
      const notas = {};
      const src = av.notas && typeof av.notas === 'object' ? av.notas : {};
      Object.keys(src).forEach(k => {
        const id = String(k);
        const n = Math.min(5, Math.max(1, Math.round(+src[k])));
        if (id && !isNaN(n) && id !== avaliadorId) notas[id] = n;
      });
      if (!Object.keys(notas).length) return null;
      const stats = {};
      const srcStats = av.stats && typeof av.stats === 'object' ? av.stats : {};
      Object.keys(srcStats).forEach(k => {
        const id = String(k);
        if (!id) return;
        const s = srcStats[k];
        let gols = 0;
        let assistencias = 0;
        let defesas = 0;
        if (Array.isArray(s)) {
          gols = Math.max(0, Math.round(+s[0] || 0));
          assistencias = Math.max(0, Math.round(+s[1] || 0));
          defesas = Math.max(0, Math.round(+s[2] || 0));
        } else if (s && typeof s === 'object') {
          gols = Math.max(0, Math.round(+s.gols || 0));
          assistencias = Math.max(0, Math.round(+s.assistencias || 0));
          defesas = Math.max(0, Math.round(+s.defesas || 0));
        }
        const entry = { gols, assistencias };
        const temDefesas = Array.isArray(s)
          ? s.length > 2
          : !!(s && typeof s === 'object' && Object.prototype.hasOwnProperty.call(s, 'defesas'));
        if (temDefesas) entry.defesas = defesas;
        stats[id] = entry;
      });
      const out = {
        id: av.id || crypto.randomUUID(),
        partidaId,
        data: typeof av.data === 'string' ? av.data : '',
        avaliadorId,
        notas,
        importadoEm: typeof av.importadoEm === 'string' ? av.importadoEm : '',
        aprovadaEm: av.aprovadaEm || null,
        rejeitadaEm: av.rejeitadaEm || null
      };
      if (Object.keys(stats).length) out.stats = stats;
      return out;
    }

    function normalizeTimes(times) {
      if (!times) return [];
      if (Array.isArray(times)) {
        return times.filter(t => Array.isArray(t)).map(t => t.slice());
      }
      if (typeof times === 'object') {
        const order = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
        const list = [];
        order.forEach(k => {
          if (Array.isArray(times[k])) list.push(times[k].slice());
        });
        Object.keys(times).forEach(k => {
          if (!order.includes(k) && Array.isArray(times[k])) list.push(times[k].slice());
        });
        if (list.every(t => t.length === 0)) return [];
        return list.filter(t => t.length > 0);
      }
      return [];
    }

    function teamLetter(i) {
      return String.fromCharCode(65 + i);
    }

    const TEAM_COLORS = ['#42a5f5', '#ab47bc', '#66bb6a', '#ffa726', '#ef5350', '#26c6da'];

    function teamColor(i) {
      return TEAM_COLORS[i % TEAM_COLORS.length];
    }

    function getTimesList(partida) {
      return normalizeTimes(partida?.times);
    }

    function timesTemJogadores(partida) {
      return getTimesList(partida).some(t => t.length > 0);
    }

    function calcNumTimes(n, sizePer) {
      if (n < 2) return n;
      return Math.max(2, Math.ceil(n / sizePer));
    }

    /** Prioriza times no tamanho ideal; sobra no último (ex.: 13 / 5 → [5,5,3]). */
    function calcTeamCapacities(n, numTimes, sizePer) {
      const ideal = Math.max(1, sizePer || 5);
      const sizes = Array(numTimes).fill(0);
      let remaining = n;
      for (let i = 0; i < numTimes; i++) {
        const teamsLeft = numTimes - i;
        if (teamsLeft === 1) {
          sizes[i] = remaining;
          break;
        }
        // Completa até o ideal, mas deixa ≥1 jogador para cada time restante
        const take = Math.min(ideal, remaining - (teamsLeft - 1));
        sizes[i] = Math.max(1, take);
        remaining -= sizes[i];
      }
      return sizes;
    }

    let state = null;
    let persistBusy = false;

    async function load() {
      const loaded = await hydrateState();
      aplicarNivelAvaliacaoNoParsed(loaded);
      return loaded;
    }

    function flashSaved() {
      const b = document.getElementById('save-badge');
      if (!b) return;
      b.style.display = '';
      clearTimeout(flashSaved._t);
      flashSaved._t = setTimeout(() => { b.style.display = 'none'; }, 2000);
    }

    async function save() {
      if (!state || persistBusy) {
        if (state && persistBusy) save._queued = true;
        return;
      }
      persistBusy = true;
      try {
        do {
          save._queued = false;
          // Snapshot completo: remove órfãos (partidas/jogadores/avaliações) e grava tudo
          await persistState(state);
          flashSaved();
        } while (save._queued);
      } catch (e) {
        console.error(e);
        alert('Erro ao salvar no Supabase: ' + (e.message || e));
      } finally {
        persistBusy = false;
      }
    }

    const brl = v => 'R$ ' + v.toFixed(2).replace('.', ',');

    function formatISODate(d) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
    function parseISODate(s) {
      const [y, m, d] = s.split('-').map(Number);
      return new Date(y, m - 1, d);
    }
    function getPeladaDiaSemana() {
      const d = state?.peladaDiaSemana;
      return d >= 0 && d <= 6 ? d : 3;
    }
    function labelDiaSemana(dia = getPeladaDiaSemana()) {
      return DIAS_SEMANA[dia] || 'Quarta-feira';
    }
    function labelDiaSemanaCurto(dia = getPeladaDiaSemana()) {
      return DIAS_SEMANA_CURTO[dia] || 'quarta';
    }
    function getPeladaHoraInicio() {
      return normalizeHora(state?.peladaHoraInicio) || '21:00';
    }
    function getPeladaHoraFim() {
      return normalizeHora(state?.peladaHoraFim) || '23:00';
    }
    function labelPeladaHorario() {
      return `${getPeladaHoraInicio()}–${getPeladaHoraFim()}`;
    }
    function labelPeladaResumo() {
      return `${labelDiaSemanaCurto()}s ${labelPeladaHorario()}`;
    }
    function isDiaPelada(dateStr, diaSemana = getPeladaDiaSemana()) {
      return parseISODate(dateStr).getDay() === diaSemana;
    }
    function isQuarta(dateStr) {
      return isDiaPelada(dateStr, 3);
    }
    function ultimaPelada(from = new Date(), diaSemana = getPeladaDiaSemana(), dataInicio = null) {
      const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
      const day = d.getDay();
      const diff = day >= diaSemana ? day - diaSemana : day + 7 - diaSemana;
      d.setDate(d.getDate() - diff);
      const minIso = typeof dataInicio === 'string' ? dataInicio : (state?.peladaDataInicio || '');
      if (minIso && /^\d{4}-\d{2}-\d{2}$/.test(minIso)) {
        const min = parseISODate(minIso);
        if (d < min) return min;
      }
      return d;
    }
    function ultimaQuarta(from = new Date()) {
      return ultimaPelada(from, 3);
    }
    function proximaPeladaApos(dateStr, diaSemana = getPeladaDiaSemana()) {
      const d = parseISODate(dateStr);
      d.setDate(d.getDate() + 1);
      while (d.getDay() !== diaSemana) d.setDate(d.getDate() + 1);
      return formatISODate(d);
    }
    function proximaQuartaApos(dateStr) {
      return proximaPeladaApos(dateStr, 3);
    }
    function dataPadraoPartida() {
      return formatISODate(ultimaPelada(new Date(), getPeladaDiaSemana(), state?.peladaDataInicio || null));
    }
    function isoToBR(iso) {
      if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || '';
      const [y, m, d] = iso.split('-');
      return `${d}/${m}/${y}`;
    }
    function brToISO(br) {
      const m = String(br || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (!m) return null;
      const d = m[1].padStart(2, '0');
      const mo = m[2].padStart(2, '0');
      const y = m[3];
      const dt = new Date(+y, +mo - 1, +d);
      if (dt.getFullYear() !== +y || dt.getMonth() !== +mo - 1 || dt.getDate() !== +d) return null;
      return `${y}-${mo}-${d}`;
    }
    function formatDataBR(dateStr) {
      return isoToBR(dateStr);
    }
    function formatDataBRLong(dateStr) {
      const d = parseISODate(dateStr);
      const wd = d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
      return `${wd} ${isoToBR(dateStr)}`;
    }
    function normalizeHora(h) {
      const m = String(h || '').trim().match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return null;
      const hh = Math.min(23, Math.max(0, +m[1]));
      const mm = Math.min(59, Math.max(0, +m[2]));
      return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    }
    function parseMesAno(mesAno) {
      const parts = (mesAno || '').trim().split(/\s+/);
      if (parts.length < 2) {
        const d = new Date();
        return { mes: d.getMonth(), ano: d.getFullYear() };
      }
      const ano = parseInt(parts[parts.length - 1], 10);
      const mesNome = parts.slice(0, -1).join(' ');
      const mes = MESES.findIndex(m => m.toLowerCase() === mesNome.toLowerCase());
      if (mes < 0 || isNaN(ano)) {
        const d = new Date();
        return { mes: d.getMonth(), ano: d.getFullYear() };
      }
      return { mes, ano };
    }
    function formatMesAno(mes, ano) {
      const m = Math.min(11, Math.max(0, Math.round(+mes) || 0));
      const a = +ano || new Date().getFullYear();
      return `${MESES[m]} ${a}`;
    }
    function proximoMesAno(mesAno) {
      const { mes, ano } = parseMesAno(mesAno);
      if (mes === 11) return formatMesAno(0, ano + 1);
      return formatMesAno(mes + 1, ano);
    }
    function partidaNoMes(partida, mesAno) {
      const { mes, ano } = parseMesAno(mesAno);
      const d = parseISODate(partida.data);
      return d.getMonth() === mes && d.getFullYear() === ano;
    }
    function pontosDe(stats) {
      return (stats.gols || 0) * 3 + (stats.assistencias || 0) * 2 + (stats.defesas || 0) * 1;
    }
    function agregaParticipantes(partidas) {
      const map = new Map();
      partidas.forEach(p => {
        (p.participantes || []).forEach(part => {
          const key = String(part.playerId);
          if (!map.has(key)) {
            map.set(key, { playerId: part.playerId, nome: part.nome, gols: 0, assistencias: 0, defesas: 0, jogos: 0 });
          }
          const row = map.get(key);
          row.nome = part.nome;
          row.gols += part.gols || 0;
          row.assistencias += part.assistencias || 0;
          row.defesas += part.defesas || 0;
          row.jogos += 1;
        });
      });
      return [...map.values()].map(r => ({ ...r, pontos: pontosDe(r) }))
        .sort((a, b) => b.pontos - a.pontos || b.gols - a.gols || b.assistencias - a.assistencias || a.nome.localeCompare(b.nome));
    }
    function getPartidasFiltradasRanking() {
      const partidas = state.partidas || [];
      if (ui.rankingFiltro === 'total') return partidas;
      if (ui.rankingFiltro === 'mensal') return partidas.filter(p => partidaNoMes(p, state.mesAno));
      if (ui.rankingFiltro === 'partida') {
        return partidas.filter(p => p.id === ui.rankingPartidaId);
      }
      return partidas;
    }

    function getAdminPerfil() {
      if (!state.adminPerfil) state.adminPerfil = { nome: '', nivel: 3, nivelAvaliacao: null, goleiro: false };
      return {
        nome: typeof state.adminPerfil.nome === 'string' ? state.adminPerfil.nome.trim() : '',
        nivel: normalizeNivel(state.adminPerfil.nivel !== undefined ? state.adminPerfil.nivel : 3),
        nivelAvaliacao: state.adminPerfil.nivelAvaliacao !== undefined
          ? normalizeNivel(state.adminPerfil.nivelAvaliacao)
          : null,
        goleiro: !!state.adminPerfil.goleiro
      };
    }

    function getAdminNome() {
      return getAdminPerfil().nome;
    }

    /** Rótulo só para UI quando o nome ainda não foi configurado (não é valor persistido). */
    function adminNomeLabel() {
      return getAdminNome() || 'Admin';
    }

    function perfilDoCadastro(origem, playerId) {
      if (origem === 'admin' || playerId == getAdmin().id) return getAdminPerfil();
      if (origem === 'mensalista') {
        const m = state.mensalistas.find(x => x.id == playerId);
        if (m) {
          return {
            nivel: normalizeNivel(m.nivel !== undefined ? m.nivel : 3),
            nivelAvaliacao: m.nivelAvaliacao !== undefined ? normalizeNivel(m.nivelAvaliacao) : null,
            goleiro: !!m.goleiro
          };
        }
      }
      if (origem === 'avulso') {
        const a = state.avulsos.find(x => x.id == playerId);
        if (a) {
          return {
            nivel: normalizeNivel(a.nivel !== undefined ? a.nivel : 3),
            nivelAvaliacao: a.nivelAvaliacao !== undefined ? normalizeNivel(a.nivelAvaliacao) : null,
            goleiro: !!a.goleiro
          };
        }
      }
      return { nivel: 3, nivelAvaliacao: null, goleiro: false };
    }

    function snapshotParticipante({ playerId, nome, origem }) {
      const perfil = perfilDoCadastro(origem, playerId);
      return {
        playerId,
        nome,
        origem,
        nivel: perfil.nivel,
        nivelAvaliacao: perfil.nivelAvaliacao !== undefined ? perfil.nivelAvaliacao : null,
        goleiro: perfil.goleiro,
        gols: 0,
        assistencias: 0,
        defesas: 0
      };
    }

    function golTag(goleiro) {
      return goleiro ? ' <span style="color:#00e5ff;font-size:0.65rem;letter-spacing:1px">GOL</span>' : '';
    }

    function cycleNivelMens(id) {
      state.mensalistas = state.mensalistas.map(m =>
        m.id === id ? { ...m, nivel: cycleNivelValue(m.nivel) } : m
      );
      save();
      render();
    }
    function toggleGoleiroMens(id) {
      state.mensalistas = state.mensalistas.map(m =>
        m.id === id ? { ...m, goleiro: !m.goleiro } : m
      );
      save();
      render();
    }
    function cycleNivelAv(id) {
      state.avulsos = state.avulsos.map(a =>
        a.id === id ? { ...a, nivel: cycleNivelValue(a.nivel) } : a
      );
      save();
      render();
    }
    function toggleGoleiroAv(id) {
      state.avulsos = state.avulsos.map(a =>
        a.id === id ? { ...a, goleiro: !a.goleiro } : a
      );
      save();
      render();
    }
    function cycleNivelAdmin() {
      const ap = getAdminPerfil();
      state.adminPerfil = { ...ap, nivel: cycleNivelValue(ap.nivel) };
      save();
      render();
    }
    function toggleGoleiroAdmin() {
      const ap = getAdminPerfil();
      state.adminPerfil = { ...ap, goleiro: !ap.goleiro };
      save();
      render();
    }

    function base64UrlEncode(str) {
      const b64 = btoa(unescape(encodeURIComponent(str)));
      return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    function base64UrlDecode(str) {
      let b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      return decodeURIComponent(escape(atob(b64)));
    }

    function bytesToBase64Url(bytes) {
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    function base64UrlToBytes(str) {
      let b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const bin = atob(b64);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }

    function snowflakeToBytes8(idStr) {
      let n = BigInt(String(idStr));
      const bytes = new Uint8Array(8);
      for (let i = 7; i >= 0; i--) {
        bytes[i] = Number(n & 0xffn);
        n >>= 8n;
      }
      return bytes;
    }

    function bytes8ToSnowflake(bytes) {
      let n = 0n;
      for (let i = 0; i < 8; i++) n = (n << 8n) | BigInt(bytes[i]);
      return n.toString();
    }

    function parseWebhookToken(urlOrToken) {
      if (!urlOrToken || typeof urlOrToken !== 'string') return '';
      const t = urlOrToken.trim();
      const m = t.match(/discord(?:app)?\.com\/api\/webhooks\/(\d+\/[A-Za-z0-9_-]+)/i);
      if (m) return m[1];
      if (/^\d+\/[A-Za-z0-9_-]+$/.test(t)) return t;
      return '';
    }

    /** Empacota: base64url(uint64 BE) + '~' + token cru. */
    function packWebhookBinary(urlOrToken) {
      const pair = parseWebhookToken(urlOrToken);
      if (!pair) return '';
      const slash = pair.indexOf('/');
      if (slash < 1) return '';
      const idStr = pair.slice(0, slash);
      const tok = pair.slice(slash + 1);
      if (!/^\d+$/.test(idStr) || !tok) return '';
      return bytesToBase64Url(snowflakeToBytes8(idStr)) + '~' + tok;
    }

    /** Aceita: idB64~token, legado id/token, ou URL completa. */
    function unpackWebhookBinary(packed) {
      if (!packed || typeof packed !== 'string') return '';
      const t = packed.trim();
      if (/^https?:\/\//i.test(t)) return t;
      const legacy = parseWebhookToken(t);
      if (legacy) return DISCORD_WEBHOOK_PREFIX + legacy;
      try {
        const tilde = t.indexOf('~');
        if (tilde < 1) return '';
        const idBytes = base64UrlToBytes(t.slice(0, tilde));
        if (idBytes.length !== 8) return '';
        const id = bytes8ToSnowflake(idBytes);
        const tok = t.slice(tilde + 1);
        if (!/^\d+$/.test(id) || !tok) return '';
        return DISCORD_WEBHOOK_PREFIX + id + '/' + tok;
      } catch (e) {
        return '';
      }
    }

    function webhookUrlFromToken(w) {
      return unpackWebhookBinary(w);
    }

    function isoToYymmdd(iso) {
      if (!iso || typeof iso !== 'string' || iso.length < 10) return '';
      return iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10);
    }

    function yymmddToIso(d) {
      if (!d || typeof d !== 'string' || d.length !== 6) return '';
      return '20' + d.slice(0, 2) + '-' + d.slice(2, 4) + '-' + d.slice(4, 6);
    }

    /** Infere origem quando falta ou está inválida (dados antigos / digitação). */
    function origemEfetivaParticipante(part, parsed) {
      const o = part && part.origem;
      if (o === 'admin' || o === 'mensalista' || o === 'avulso' || o === 'convidado') return o;
      const pid = part && part.playerId;
      if (pid == getAdmin().id) return 'admin';
      const src = parsed || state;
      if ((src.mensalistas || []).some(m => m.id == pid)) return 'mensalista';
      if ((src.avulsos || []).some(a => a.id == pid)) return 'avulso';
      return 'convidado';
    }

    /**
     * Todos que jogaram entram na avaliação (inclui convidados/avulsos).
     * Antes só admin/mensalista/avulso — quem ia como "convidado" (nome digitado) sumia da lista.
     */
    /** Roster do link: [id, nome] ou [id, nome, 1] se goleiro. */
    function jogadoresAvaliaveisDaPartida(partida) {
      return (partida.participantes || [])
        .map(p => {
          const id = String(p.playerId);
          const nome = String(p.nome || '').trim();
          if (!id || !nome) return null;
          return p.goleiro ? [id, nome, 1] : [id, nome];
        })
        .filter(Boolean);
    }

    function isGoleiroNoPayloadAvaliar(playerId) {
      const row = (avaliarUi.payload && avaliarUi.payload.j || []).find(([id]) => sameId(id, playerId));
      return !!(row && row[2]);
    }

    /** Se o nome digitado bate com cadastro, reusa id/origem (evita mensalista “sumir” da avaliação). */
    function resolverJogadorPorNome(nomeRaw) {
      const nome = String(nomeRaw || '').trim();
      if (!nome) return null;
      const key = nome.toLowerCase();
      const adminNome = adminNomeLabel().trim();
      if (adminNome && adminNome.toLowerCase() === key) {
        return { playerId: getAdmin().id, nome: adminNome, origem: 'admin' };
      }
      const m = state.mensalistas.find(x => String(x.nome || '').trim().toLowerCase() === key);
      if (m) return { playerId: m.id, nome: m.nome, origem: 'mensalista' };
      const a = state.avulsos.find(x => String(x.nome || '').trim().toLowerCase() === key);
      if (a) return { playerId: a.id, nome: a.nome, origem: 'avulso' };
      return { playerId: crypto.randomUUID(), nome, origem: 'convidado' };
    }

    function montarPayloadLinkAvaliacao(partida) {
      return {
        v: 1,
        p: partida.id,
        d: isoToYymmdd(partida.data),
        j: jogadoresAvaliaveisDaPartida(partida)
      };
    }

    /** Base canônica do app (sempre com / no fim) — evita 404 no GitHub Pages em `/v2#a=…`. */
    function linkAvaliacaoBase() {
      const url = new URL(location.href);
      let path = url.pathname || '/';
      if (/\/index\.html$/i.test(path)) path = path.replace(/\/index\.html$/i, '/');
      if (!path.endsWith('/')) path += '/';
      return url.origin + path;
    }

    /** Link curto: #a=<partidaUuid> (roster vem da nuvem). */
    function linkAvaliacaoPartida(partida) {
      return linkAvaliacaoBase() + '#a=' + partida.id;
    }

    function payloadFromPartidaApi(data) {
      const dataIso = data.data || '';
      return {
        v: 1,
        p: String(data.partidaId),
        d: isoToYymmdd(dataIso),
        j: (data.participantes || []).map((p) => {
          const id = String(p.playerId);
          const nome = String(p.nome || '').trim();
          if (!id || !nome) return null;
          return p.goleiro ? [id, nome, 1] : [id, nome];
        }).filter(Boolean),
        w: ''
      };
    }

    function statsNotasRecebidas(playerId) {
      let sum = 0;
      let count = 0;
      (state.avaliacoes || []).forEach(av => {
        if (!isAvaliacaoAprovada(av)) return;
        const n = av.notas && (av.notas[playerId] ?? av.notas[String(playerId)]);
        if (n !== undefined && n !== null && !isNaN(+n)) {
          sum += +n;
          count++;
        }
      });
      if (!count) return null;
      return { media: sum / count, count };
    }

    function tituloNivelBadge(nivel) {
      return `Nível manual: ${formatNivel(nivel)} (toque para ciclar) · usado no sorteio de times`;
    }

    function badgeAvHtml(playerId, nivelAvaliacao) {
      const st = statsNotasRecebidas(playerId);
      const title = st
        ? `Av = average (média das avaliações): ${st.media.toFixed(1)} (${st.count} nota${st.count !== 1 ? 's' : ''})`
        : 'Av = average — ainda sem avaliações aprovadas';
      return `<span class="badge badge-av" title="${title}">Av ${formatNivel(nivelAvaliacao)}</span>`;
    }

    function recalcularNiveis() {
      aplicarNivelAvaliacaoNoParsed(state);
    }

    function aplicarStatsAvaliacoesNasPartidas(partidaIds) {
      const filtro = partidaIds && partidaIds.length
        ? new Set(partidaIds.map(String))
        : null;
      const byPartida = {};
      (state.avaliacoes || []).forEach(av => {
        if (!isAvaliacaoAprovada(av)) return;
        if (filtro && !filtro.has(String(av.partidaId))) return;
        if (!av.stats || typeof av.stats !== 'object') return;
        const pid = String(av.partidaId);
        if (!byPartida[pid]) byPartida[pid] = {};
        Object.keys(av.stats).forEach(playerKey => {
          const s = av.stats[playerKey];
          if (!s) return;
          const g = Math.max(0, Math.round(+s.gols || 0));
          const a = Math.max(0, Math.round(+s.assistencias || 0));
          const d = Math.max(0, Math.round(+s.defesas || 0));
          if (!byPartida[pid][playerKey]) byPartida[pid][playerKey] = { gols: [], assistencias: [], defesas: [] };
          byPartida[pid][playerKey].gols.push(g);
          byPartida[pid][playerKey].assistencias.push(a);
          if (Object.prototype.hasOwnProperty.call(s, 'defesas')) {
            byPartida[pid][playerKey].defesas.push(d);
          }
        });
      });
      const partidasAlvo = filtro
        ? [...filtro]
        : [...new Set((state.partidas || []).map(p => String(p.id)))];
      partidasAlvo.forEach(partidaId => {
        const partida = findPartida(partidaId);
        if (!partida) return;
        const bucketMap = byPartida[partidaId] || {};
        (partida.participantes || []).forEach(part => {
          const playerKey = String(part.playerId);
          const bucket = bucketMap[playerKey];
          if (!bucket) {
            part.gols = 0;
            part.assistencias = 0;
            part.defesas = 0;
            return;
          }
          const avg = arr => Math.round(arr.reduce((sum, x) => sum + x, 0) / arr.length);
          part.gols = avg(bucket.gols);
          part.assistencias = avg(bucket.assistencias);
          part.defesas = bucket.defesas.length ? avg(bucket.defesas) : 0;
        });
      });
    }

    function resetarAvaliacoes() {
      const n = (state.avaliacoes || []).length;
      const temAv = temNivelAvCadastrado();
      if (!n && !temAv) {
        alert('Não há avaliações nem nível Av para resetar.');
        return;
      }
      if (!confirm(
        `Apagar ${n ? `todas as ${n} avaliação(ões)` : 'os níveis Av salvos'}?\n\n` +
        'O nível Av de todos os jogadores volta para ?. Gols e assistências das partidas voltam a 0.'
      )) return;
      const partidaIds = (state.partidas || []).map(p => p.id);
      state.avaliacoes = [];
      aplicarStatsAvaliacoesNasPartidas(partidaIds);
      recalcularNiveis();
      save();
      render();
      alert('Avaliações resetadas. Nível Av voltou para ?.');
    }

    function resetarAvaliacoesPartida(partidaId) {
      const daPartida = (state.avaliacoes || []).filter(a => a.partidaId == partidaId);
      if (!daPartida.length) {
        alert('Nenhuma avaliação para esta partida.');
        return;
      }
      if (!confirm(
        `Apagar ${daPartida.length} avaliação(ões) desta partida?\n\n` +
        'O nível Av é recalculado com o que sobrar. Gols/assistências desta partida voltam a 0.'
      )) return;
      state.avaliacoes = (state.avaliacoes || []).filter(a => a.partidaId != partidaId);
      aplicarStatsAvaliacoesNasPartidas([partidaId]);
      recalcularNiveis();
      save();
      render();
      alert('Avaliações desta partida removidas.');
    }

    function updateDiscordWebhook() {
      const el = document.getElementById('cfg-discord-webhook');
      state.discordWebhookUrl = el ? el.value.trim() : '';
      save();
    }

    async function testarDiscordWebhook() {
      updateDiscordWebhook();
      const url = webhookUrlFromToken(state.discordWebhookUrl);
      if (!url) {
        alert('Cole uma URL de webhook Discord válida em Ajustes.');
        return;
      }
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: '⚽ Fut Manager: webhook OK' })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        alert('Ping enviado! Confira o canal no Discord.');
      } catch (e) {
        alert('Falha ao enviar. Confira a URL e a conexão.');
      }
    }

    function copiarLinkAvaliacao(partidaId) {
      const p = findPartida(partidaId);
      if (!p) return;
      const jogadores = jogadoresAvaliaveisDaPartida(p);
      if (!jogadores.length) {
        alert('Nenhum jogador nesta partida para avaliar.');
        return;
      }
      const link = linkAvaliacaoPartida(p);
      const txt = `⚽ Avaliem a partida de ${formatDataBR(p.data)}:\n${link}`;
      copyText(txt, 'Link de avaliação copiado! Mande no grupo.');
    }

    function decodePayloadAvaliacao(hashAfterA) {
      const raw = String(hashAfterA || '');
      const dot = raw.indexOf('.');
      const jsonPart = dot >= 0 ? raw.slice(0, dot) : raw;
      const wPart = dot >= 0 ? raw.slice(dot + 1) : '';
      const payload = JSON.parse(base64UrlDecode(jsonPart));
      if (!payload || payload.v !== 1 || !Array.isArray(payload.j) || !payload.j.length) {
        throw new Error('payload inválido');
      }
      payload.j = payload.j
        .map(row => {
          if (!Array.isArray(row) || row.length < 2) return null;
          const id = String(row[0] || '');
          const nome = String(row[1] || '').trim();
          if (!id || !nome) return null;
          return row[2] ? [id, nome, 1] : [id, nome];
        })
        .filter(Boolean);
      if (!payload.j.length) throw new Error('sem jogadores');
      payload.w = wPart || payload.w || '';
      return payload;
    }

    /** Extrai UUID do hash mesmo se vier lixo após (WhatsApp, tracking). */
    function extractPartidaIdFromHashRaw(raw) {
      const s = String(raw || '').trim();
      const m = s.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i);
      return m ? m[1] : '';
    }

    function showAvaliarError(msg) {
      enterModoAvaliarChrome();
      const root = document.getElementById('view-avaliar');
      if (!root) return;
      root.innerHTML = `
        <div class="avaliar-title">AVALIAR PARTIDA</div>
        <div class="avaliar-sub" style="color:#ff8a80">${msg || 'Não foi possível abrir este link.'}</div>
        <p class="avaliar-sub">Peça um novo link de avaliação ao organizador.</p>
      `;
    }

    function enterModoAvaliarChrome() {
      document.documentElement.classList.add('modo-avaliar');
      document.body.classList.add('modo-avaliar');
    }

    function exitModoAvaliarChrome() {
      document.documentElement.classList.remove('modo-avaliar');
      document.body.classList.remove('modo-avaliar');
      const va = document.getElementById('view-avaliar');
      if (va) va.innerHTML = '';
    }

    function showAvaliarLoading() {
      enterModoAvaliarChrome();
      const root = document.getElementById('view-avaliar');
      if (!root || avaliarUi.payload) return;
      root.innerHTML = `
        <div class="avaliar-title">AVALIAR PARTIDA</div>
        <div class="avaliar-sub">Carregando partida…</div>
      `;
    }

    async function bootAvaliacaoFromHash() {
      const hash = location.hash || '';
      if (!hash.startsWith('#a=')) return false;
      const raw = hash.slice(3);
      showAvaliarLoading();
      try {
        let payload;
        const partidaId = extractPartidaIdFromHashRaw(raw);
        if (partidaId) {
          const data = await fetchPartidaAvaliacao(partidaId);
          payload = payloadFromPartidaApi(data);
          if (!payload.j.length) throw new Error('Partida sem jogadores');
        } else {
          // Links legados #a=<jsonB64>.<webhook>
          payload = decodePayloadAvaliacao(raw);
        }
        avaliarUi.payload = payload;
        avaliarUi.avaliadorId = null;
        avaliarUi.notas = {};
        avaliarUi.stats = {};
        avaliarUi.enviando = false;
        enterModoAvaliarChrome();
        renderAvaliar();
        return true;
      } catch (e) {
        console.warn(e);
        avaliarUi.payload = null;
        avaliarUi.avaliadorId = null;
        avaliarUi.notas = {};
        avaliarUi.stats = {};
        const msg = (e && e.message) ? String(e.message) : 'Link de avaliação inválido ou partida não encontrada.';
        showAvaliarError(msg);
        return false;
      }
    }

    function ensureStatsAvaliar(playerId) {
      const key = String(playerId);
      if (!avaliarUi.stats[key]) {
        avaliarUi.stats[key] = { gols: 0, assistencias: 0, defesas: 0 };
      } else if (avaliarUi.stats[key].defesas === undefined) {
        avaliarUi.stats[key].defesas = 0;
      }
      return avaliarUi.stats[key];
    }

    function setAvaliadorAvaliar(id) {
      if (!id) {
        avaliarUi.avaliadorId = null;
        renderAvaliar();
        return;
      }
      avaliarUi.avaliadorId = String(id);
      delete avaliarUi.notas[String(id)];
      delete avaliarUi.notas[id];
      ensureStatsAvaliar(avaliarUi.avaliadorId);
      renderAvaliar();
    }

    function setNotaAvaliar(avaliadoId, nota) {
      if (!avaliarUi.avaliadorId) return;
      if (sameId(avaliadoId, avaliarUi.avaliadorId)) return;
      avaliarUi.notas[String(avaliadoId)] = Math.min(5, Math.max(1, Math.round(+nota)));
      renderAvaliar();
    }

    function adjStatAvaliar(playerId, campo, delta) {
      if (!avaliarUi.avaliadorId) return;
      // Só os próprios números
      if (!sameId(playerId, avaliarUi.avaliadorId)) return;
      if (campo === 'defesas') {
        if (!isGoleiroNoPayloadAvaliar(playerId)) return;
      } else if (campo !== 'gols' && campo !== 'assistencias') {
        return;
      }
      const st = ensureStatsAvaliar(playerId);
      st[campo] = Math.max(0, (st[campo] || 0) + delta);
      renderAvaliar();
    }

    function montarPacoteDoFormAvaliar() {
      const p = avaliarUi.payload;
      if (!p || !avaliarUi.avaliadorId) return null;
      const notas = {};
      p.j.forEach(([id]) => {
        if (sameId(id, avaliarUi.avaliadorId)) return;
        const n = avaliarUi.notas[String(id)] ?? avaliarUi.notas[id];
        if (n !== undefined) notas[String(id)] = +n;
      });
      const esperados = p.j.filter(([id]) => !sameId(id, avaliarUi.avaliadorId)).length;
      if (Object.keys(notas).length < esperados) return null;
      const st = ensureStatsAvaliar(avaliarUi.avaliadorId);
      const selfStats = {
        gols: Math.max(0, Math.round(+st.gols || 0)),
        assistencias: Math.max(0, Math.round(+st.assistencias || 0))
      };
      if (isGoleiroNoPayloadAvaliar(avaliarUi.avaliadorId)) {
        selfStats.defesas = Math.max(0, Math.round(+st.defesas || 0));
      }
      return {
        v: 1,
        tipo: 'avaliacao-partida',
        partidaId: String(p.p),
        data: yymmddToIso(p.d) || '',
        avaliadorId: String(avaliarUi.avaliadorId),
        notas,
        stats: { [String(avaliarUi.avaliadorId)]: selfStats }
      };
    }

    function nomeAvaliadorAtual() {
      const p = avaliarUi.payload;
      if (!p || !avaliarUi.avaliadorId) return '';
      const row = p.j.find(([id]) => sameId(id, avaliarUi.avaliadorId));
      return row ? row[1] : '';
    }

    async function enviarAvaliacaoDiscord() {
      const pacote = montarPacoteDoFormAvaliar();
      if (!pacote) {
        alert('Escolha quem é você e dê nota (1–5) a todos os outros. Seus gols/assistências (e defesas, se goleiro) são opcionais.');
        return;
      }
      if (avaliarUi.enviando) return;
      avaliarUi.enviando = true;
      renderAvaliar();
      try {
        await submitAvaliacao({
          partidaId: pacote.partidaId,
          avaliadorId: pacote.avaliadorId,
          notas: pacote.notas,
          stats: pacote.stats,
          data: pacote.data,
        });
        alert('Avaliação enviada! Aguarde aprovação do organizador.');
      } catch (e) {
        alert('Falha ao enviar avaliação: ' + (e.message || e));
      } finally {
        avaliarUi.enviando = false;
        renderAvaliar();
      }
    }

    function htmlStatsPropriosAvaliar(playerId) {
      const st = ensureStatsAvaliar(playerId);
      const goleiro = isGoleiroNoPayloadAvaliar(playerId);
      let html = `<div class="avaliar-ga">
        <div class="avaliar-ga-item">
          <span>G</span>
          <button type="button" class="stat-btn" onclick="adjStatAvaliar(${jsArg(playerId)},'gols',-1)">−</button>
          <span class="stat-val">${st.gols || 0}</span>
          <button type="button" class="stat-btn" onclick="adjStatAvaliar(${jsArg(playerId)},'gols',1)">+</button>
        </div>
        <div class="avaliar-ga-item">
          <span>A</span>
          <button type="button" class="stat-btn" onclick="adjStatAvaliar(${jsArg(playerId)},'assistencias',-1)">−</button>
          <span class="stat-val">${st.assistencias || 0}</span>
          <button type="button" class="stat-btn" onclick="adjStatAvaliar(${jsArg(playerId)},'assistencias',1)">+</button>
        </div>`;
      if (goleiro) {
        html += `
        <div class="avaliar-ga-item">
          <span>D</span>
          <button type="button" class="stat-btn" onclick="adjStatAvaliar(${jsArg(playerId)},'defesas',-1)">−</button>
          <span class="stat-val">${st.defesas || 0}</span>
          <button type="button" class="stat-btn" onclick="adjStatAvaliar(${jsArg(playerId)},'defesas',1)">+</button>
        </div>`;
      }
      html += `</div>`;
      return html;
    }

    function renderAvaliar() {
      const root = document.getElementById('view-avaliar');
      if (!root || !avaliarUi.payload) return;
      const p = avaliarUi.payload;
      const dataIso = yymmddToIso(p.d);
      const dataLabel = dataIso ? formatDataBRLong(dataIso) : ('Partida #' + p.p);
      const souGoleiro = avaliarUi.avaliadorId && isGoleiroNoPayloadAvaliar(avaliarUi.avaliadorId);

      const opcoes = p.j.map(([id, nome, gFlag]) =>
        `<option value="${id}" ${sameId(avaliarUi.avaliadorId, id) ? 'selected' : ''}>${nome}${gFlag ? ' (GOL)' : ''}</option>`
      ).join('');

      let listaHtml = '';
      if (avaliarUi.avaliadorId) {
        const selfRow = p.j.find(([id]) => sameId(id, avaliarUi.avaliadorId));
        const selfNome = selfRow ? selfRow[1] : 'Você';
        const outros = p.j.filter(([id]) => !sameId(id, avaliarUi.avaliadorId));
        const statsLabel = souGoleiro ? 'Seus gols, assistências e defesas' : 'Seus gols e assistências';
        listaHtml =
          `<div class="avaliar-nota-row">
            <div class="avaliar-nota-top"><span><strong>Você</strong> · ${selfNome}${souGoleiro ? ' · GOL' : ''}</span></div>
            <p class="avaliar-sub" style="margin:0 0 6px;font-size:0.75rem">${statsLabel}</p>
            ${htmlStatsPropriosAvaliar(avaliarUi.avaliadorId)}
          </div>` +
          outros.map(([id, nome]) => {
            const atual = avaliarUi.notas[String(id)] ?? avaliarUi.notas[id];
            const btns = [1, 2, 3, 4, 5].map(n =>
              `<button type="button" class="${+atual === n ? 'sel' : ''}" onclick="setNotaAvaliar(${jsArg(id)},${n})">${n}</button>`
            ).join('');
            return `<div class="avaliar-nota-row">
              <div class="avaliar-nota-top"><span>${nome}</span><div class="avaliar-nota-btns">${btns}</div></div>
            </div>`;
          }).join('');
      } else {
        listaHtml = `<p class="avaliar-sub" style="margin:0">Selecione quem é você para liberar notas e seus números.</p>`;
      }

      root.innerHTML = `
        <div class="avaliar-title">AVALIAR PARTIDA</div>
        <div class="avaliar-sub">${dataLabel} · ${p.j.length} jogadores</div>
        <div class="card">
          <div class="section-title">QUEM É VOCÊ?</div>
          <select class="fut-input" onchange="setAvaliadorAvaliar(this.value)">
            <option value="">Selecionar...</option>
            ${opcoes}
          </select>
        </div>
        <div class="card">
          <div class="section-title">NOTAS · SEUS NÚMEROS</div>
          ${listaHtml}
        </div>
        <div class="avaliar-actions">
          <button type="button" class="btn-add" style="width:100%;background:#00e676;color:#000"
            onclick="enviarAvaliacaoDiscord()" ${avaliarUi.enviando ? 'disabled' : ''}>
            ${avaliarUi.enviando ? 'Enviando…' : 'Enviar avaliação'}
          </button>
        </div>
        <p class="avaliar-sub" style="margin-top:12px">Não se avalia a si mesmo. Dê nota a todos os outros. Registre só os seus gols (G) e assistências (A)${souGoleiro ? ' e defesas (D)' : ''}. O organizador aprova antes de computar.</p>
      `;
    }

    function setTab(t) {
      const tabs = ['resumo', 'mensalistas', 'avulsos', 'partidas', 'ranking', 'ajustes'];
      document.querySelectorAll('.tab-btn').forEach((b, i) => b.classList.toggle('active', tabs[i] === t));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      document.getElementById('tab-' + t).classList.add('active');
      if (t === 'partidas' && ui.partidaView === 'nova' && !ui.draftData) resetDraftNovaPartida();
      render();
    }

    function render() {
      const { mensalistas, avulsos, custoQuadra, saldoAnterior, avulsosPendentesAnt, valorMensalidade, valorAvulso, mesAno, chavePix, debitos, outrosDebitos } = state;
      const pagos = mensalistas.filter(m => m.pago), pend = mensalistas.filter(m => !m.pago);
      const avP = avulsos.filter(a => a.status === 'pago'), avPend = avulsos.filter(a => a.status === 'pendente');
      const totalMens = pagos.length * valorMensalidade, totalAvP = avP.length * valorAvulso, totalAvPend = avPend.length * valorAvulso;
      const totalDebitos = +outrosDebitos || 0;
      const totalRec = saldoAnterior + avulsosPendentesAnt * valorAvulso + totalMens + totalAvP;
      const lucro = totalRec - custoQuadra - totalDebitos, aRec = pend.length * valorMensalidade + totalAvPend;

      const futNome = state.meta?.futNome || 'Fut';
      document.getElementById('header-mes-ano').textContent = `${futNome} — ${mesAno || obterMesAnoAtual()} ✏️`;
      renderFutSelector();

      const lv = document.getElementById('lucro-valor');
      lv.textContent = brl(lucro); lv.className = 'card-value ' + (lucro >= 0 ? 'green' : 'red');
      document.getElementById('lucro-detalhe').textContent = totalDebitos > 0
        ? `Total ${brl(totalRec)} — Quadra ${brl(custoQuadra)} — Débitos ${brl(totalDebitos)}`
        : `Total ${brl(totalRec)} — Custo ${brl(custoQuadra)}`;
      document.getElementById('saldo-val').textContent = brl(saldoAnterior);
      document.getElementById('avant-val').textContent = brl(avulsosPendentesAnt * valorAvulso);
      document.getElementById('avant-detalhe').textContent = `${avulsosPendentesAnt} × R$ ${valorAvulso} recebidos`;
      document.getElementById('mens-val').textContent = brl(totalMens);
      document.getElementById('mens-detalhe').textContent = `${pagos.length} × R$ ${valorMensalidade}`;
      document.getElementById('avpagos-val').textContent = brl(totalAvP);
      document.getElementById('avpagos-detalhe').textContent = `${avP.length} × R$ ${valorAvulso}`;
      document.getElementById('areceber-val').textContent = brl(aRec);
      document.getElementById('areceber-detalhe').textContent = `${pend.length} mensalistas + ${avPend.length} avulsos`;
      document.getElementById('custo-val').textContent = brl(custoQuadra);
      document.getElementById('debitos-val').textContent = brl(totalDebitos);
      document.getElementById('debitos-detalhe').textContent = (debitos || []).length
        ? `${debitos.length} lançamento${debitos.length > 1 ? 's' : ''} · toque para gerenciar`
        : 'Toque para cadastrar em Ajustes';
      const pct = mensalistas.length ? pagos.length / mensalistas.length * 100 : 0;
      document.getElementById('progresso-txt').textContent = `${pagos.length} de ${mensalistas.length} pagaram`;
      document.getElementById('progresso-fill').style.width = pct + '%';
      const pc = document.getElementById('pendentes-card');
      pc.style.display = pend.length ? '' : 'none';
      document.getElementById('pendentes-lista').innerHTML = pend.map(m =>
        `<div class="row-item"><span>${m.nome}</span><span class="yellow">${brl(valorMensalidade)}</span></div>`).join('');

      document.getElementById('mens-secao-titulo').textContent = `MENSALISTAS — ${brl(valorMensalidade)}`;

      const adminPerfil = getAdminPerfil();
      const adminRow = `<div class="row-item">
      <div class="row-item-main">
        <span class="player-num">★</span>
        <span class="player-nome">${adminNomeLabel()}${golTag(adminPerfil.goleiro)}</span>
        <span style="font-family:'DM Sans',sans-serif;font-size:0.65rem;color:#00bcd4;flex-shrink:0">admin</span>
      </div>
      <div class="row-item-actions">
        <button class="badge badge-nivel" onclick="cycleNivelAdmin()" title="${tituloNivelBadge(adminPerfil.nivel)}">Nv ${formatNivel(adminPerfil.nivel)}</button>
        ${badgeAvHtml(getAdmin().id, adminPerfil.nivelAvaliacao)}
        <button class="badge ${adminPerfil.goleiro ? 'badge-gol' : 'badge-linha'}" onclick="toggleGoleiroAdmin()">${adminPerfil.goleiro ? 'GOL' : 'LINHA'}</button>
      </div>
    </div>`;

      document.getElementById('mens-lista').innerHTML = adminRow + mensalistas.map((m, i) =>
        `<div class="row-item">
      <div class="row-item-main">
        <span class="player-num">${i + 1}</span>
        <span class="player-nome">${m.nome}${golTag(m.goleiro)}</span>
      </div>
      <div class="row-item-actions">
        <button class="badge badge-nivel" onclick="cycleNivelMens(${jsArg(m.id)})" title="${tituloNivelBadge(m.nivel)}">Nv ${formatNivel(m.nivel)}</button>
        ${badgeAvHtml(m.id, m.nivelAvaliacao)}
        <button class="badge ${m.goleiro ? 'badge-gol' : 'badge-linha'}" onclick="toggleGoleiroMens(${jsArg(m.id)})">${m.goleiro ? 'GOL' : 'LINHA'}</button>
        <button class="badge ${m.pago ? 'badge-green' : 'badge-red'}" onclick="toggleMens(${jsArg(m.id)})">${m.pago ? 'PAGO ✓' : 'PENDENTE'}</button>
        <button class="btn-remove" onclick="removeMens(${jsArg(m.id)})">✕</button>
      </div>
    </div>`).join('');

      document.getElementById('avulsos-wrap').innerHTML = avulsos.length === 0
        ? `<div class="card empty-state"><div class="icon">⚡</div><p>Nenhum avulso ainda</p></div>`
        : `<div class="card"><div class="section-title">AVULSOS — R$ ${valorAvulso} cada</div>${avulsos.map(a =>
          `<div class="row-item">
          <div class="row-item-main">
            <span class="player-nome">${a.nome}${golTag(a.goleiro)}</span>
          </div>
          <div class="row-item-actions">
            <button class="badge badge-nivel" onclick="cycleNivelAv(${jsArg(a.id)})" title="${tituloNivelBadge(a.nivel)}">Nv ${formatNivel(a.nivel)}</button>
            ${badgeAvHtml(a.id, a.nivelAvaliacao)}
            <button class="badge ${a.goleiro ? 'badge-gol' : 'badge-linha'}" onclick="toggleGoleiroAv(${jsArg(a.id)})">${a.goleiro ? 'GOL' : 'LINHA'}</button>
            <button class="badge ${a.status === 'pago' ? 'badge-green' : 'badge-yellow'}" onclick="toggleAv(${jsArg(a.id)})">${a.status === 'pago' ? 'PAGO ✓' : 'PENDENTE'}</button>
            <button class="btn-remove" onclick="removeAv(${jsArg(a.id)})">✕</button>
          </div>
        </div>`).join('')}</div>`;

      document.getElementById('avtotal-pagos').textContent = brl(totalAvP);
      document.getElementById('avtotal-pagos-d').textContent = `${avP.length} jogadores`;
      document.getElementById('avtotal-pend').textContent = brl(totalAvPend);
      document.getElementById('avtotal-pend-d').textContent = `${avPend.length} jogadores`;

      const debLista = document.getElementById('debitos-lista');
      if (debLista) {
        debLista.innerHTML = !(debitos || []).length
          ? `<p style="font-family:'DM Sans',sans-serif;font-size:0.8rem;color:#555;margin:0">Nenhum débito cadastrado</p>`
          : debitos.map(d =>
            `<div class="row-item">
              <span style="font-family:'DM Sans',sans-serif">${d.descricao}</span>
              <div style="display:flex;gap:6px;align-items:center">
                <span class="red" style="font-family:'DM Sans',sans-serif">${brl(d.valor)}</span>
                <button class="btn-remove" onclick="removeDebito(${jsArg(d.id)})">✕</button>
              </div>
            </div>`).join('');
      }
      const debTotalCfg = document.getElementById('debitos-total-cfg');
      if (debTotalCfg) debTotalCfg.textContent = brl(totalDebitos);

      // Atualiza os inputs na aba Ajustes se eles existirem
      const cfgM = document.getElementById('cfg-mensalidade');
      const cfgA = document.getElementById('cfg-avulso');
      const cfgP = document.getElementById('cfg-pix');
      const cfgAdmin = document.getElementById('cfg-admin-nome');
      const cfgJpt = document.getElementById('cfg-jogadores-por-time');
      const cfgMes = document.getElementById('cfg-mes');
      const cfgAno = document.getElementById('cfg-ano');
      const cfgWh = document.getElementById('cfg-discord-webhook');
      if (cfgM) cfgM.value = valorMensalidade;
      if (cfgA) cfgA.value = valorAvulso;
      if (cfgP) cfgP.value = chavePix || '';
      if (cfgAdmin) cfgAdmin.value = getAdminPerfil().nome;
      if (cfgJpt) cfgJpt.value = getJogadoresPorTime();
      if (cfgWh && document.activeElement !== cfgWh) cfgWh.value = state.discordWebhookUrl || '';
      const cfgBalNv = document.getElementById('cfg-bal-nivel');
      const cfgBalAv = document.getElementById('cfg-bal-av');
      if (cfgBalNv && cfgBalAv) {
        const bal = getBalanceamentoTimes();
        cfgBalNv.classList.toggle('active', bal === 'nivel');
        cfgBalAv.classList.toggle('active', bal === 'avaliacao');
        cfgBalAv.classList.toggle('active-av', bal === 'avaliacao');
      }
      const { mes: mesIdx, ano: anoVig } = parseMesAno(mesAno || obterMesAnoAtual());
      if (cfgMes) cfgMes.value = String(mesIdx);
      if (cfgAno) cfgAno.value = anoVig;
      const cfgPeladaDia = document.getElementById('cfg-pelada-dia');
      const cfgPeladaIni = document.getElementById('cfg-pelada-inicio');
      const cfgPeladaFim = document.getElementById('cfg-pelada-fim');
      const cfgPeladaDataInicio = document.getElementById('cfg-pelada-data-inicio');
      if (cfgPeladaDia) cfgPeladaDia.value = String(getPeladaDiaSemana());
      if (cfgPeladaIni) cfgPeladaIni.value = getPeladaHoraInicio();
      if (cfgPeladaFim) cfgPeladaFim.value = getPeladaHoraFim();
      if (cfgPeladaDataInicio) cfgPeladaDataInicio.value = isoToBR(state.peladaDataInicio) || '';

      renderPartidas();
      renderRanking();
    }

    function resetDraftNovaPartida() {
      ui.draftData = dataPadraoPartida();
      ui.draftHoraInicio = getPeladaHoraInicio();
      ui.draftHoraFim = getPeladaHoraFim();
      ui.draftSelecionados = {};
      ui.draftSelecionados['admin:' + getAdmin().id] = true;
      state.mensalistas.forEach(m => { ui.draftSelecionados['m:' + m.id] = true; });
      state.avulsos.forEach(a => { ui.draftSelecionados['a:' + a.id] = false; });
      ui.draftConvidados = [];
    }

    function abrirNovaPartida() {
      resetDraftNovaPartida();
      ui.partidaView = 'nova';
      ui.partidaId = null;
      render();
    }
    function voltarListaPartidas() {
      ui.partidaView = 'lista';
      ui.partidaId = null;
      render();
    }
    function abrirDetalhePartida(id) {
      ui.partidaView = 'detalhe';
      ui.partidaId = id;
      render();
    }
    function syncDraftHoursFromDom() {
      const dataEl = document.getElementById('inp-partida-data');
      if (dataEl && dataEl.value.trim()) {
        const iso = brToISO(dataEl.value);
        if (iso) ui.draftData = iso;
      }
      const ini = document.getElementById('inp-partida-inicio');
      const fim = document.getElementById('inp-partida-fim');
      const nIni = ini ? normalizeHora(ini.value) : null;
      const nFim = fim ? normalizeHora(fim.value) : null;
      if (nIni) ui.draftHoraInicio = nIni;
      if (nFim) ui.draftHoraFim = nFim;
    }
    function setDraftDataFromInput() {
      syncDraftHoursFromDom();
      render();
    }
    function usarProximaPelada() {
      syncDraftHoursFromDom();
      ui.draftData = proximaPeladaApos(ui.draftData || dataPadraoPartida());
      render();
    }
    function usarProximaQuarta() {
      usarProximaPelada();
    }
    function toggleDraftPlayer(key) {
      syncDraftHoursFromDom();
      ui.draftSelecionados[key] = !ui.draftSelecionados[key];
      render();
    }
    function addDraftConvidado() {
      syncDraftHoursFromDom();
      const i = document.getElementById('inp-convidado');
      if (!i) return;
      const n = i.value.trim();
      if (!n) return;
      const resolved = resolverJogadorPorNome(n);
      if (!resolved) return;
      // Se o nome já é mensalista/avulso/admin, marca na lista em vez de criar "convidado" fantasma
      if (resolved.origem === 'admin') {
        ui.draftSelecionados['admin:' + getAdmin().id] = true;
      } else if (resolved.origem === 'mensalista') {
        ui.draftSelecionados['m:' + resolved.playerId] = true;
      } else if (resolved.origem === 'avulso') {
        ui.draftSelecionados['a:' + resolved.playerId] = true;
      } else {
        const jaTem = ui.draftConvidados.some(c => c.nome.toLowerCase() === resolved.nome.toLowerCase());
        if (!jaTem) ui.draftConvidados.push({ id: resolved.playerId, nome: resolved.nome });
      }
      i.value = '';
      render();
    }
    function removeDraftConvidado(id) {
      syncDraftHoursFromDom();
      ui.draftConvidados = ui.draftConvidados.filter(c => c.id !== id);
      render();
    }

    function criarPartida() {
      syncDraftHoursFromDom();
      const dataRaw = document.getElementById('inp-partida-data')?.value;
      const data = brToISO(dataRaw) || ui.draftData;
      const horaInicio = normalizeHora(document.getElementById('inp-partida-inicio')?.value) || ui.draftHoraInicio || getPeladaHoraInicio();
      const horaFim = normalizeHora(document.getElementById('inp-partida-fim')?.value) || ui.draftHoraFim || getPeladaHoraFim();
      if (!data) { alert('Informe a data no formato dd/mm/aaaa.'); return; }
      if (!isDiaPelada(data)) {
        if (!confirm(`A data não é ${labelDiaSemana().toLowerCase()}. O fut costuma ser às ${labelDiaSemanaCurto()}s. Continuar mesmo assim?`)) return;
      }
      const participantes = [];
      if (ui.draftSelecionados['admin:' + getAdmin().id]) {
        participantes.push(snapshotParticipante({ playerId: getAdmin().id, nome: adminNomeLabel(), origem: 'admin' }));
      }
      state.mensalistas.forEach(m => {
        if (ui.draftSelecionados['m:' + m.id]) {
          participantes.push(snapshotParticipante({ playerId: m.id, nome: m.nome, origem: 'mensalista' }));
        }
      });
      state.avulsos.forEach(a => {
        if (ui.draftSelecionados['a:' + a.id]) {
          participantes.push(snapshotParticipante({ playerId: a.id, nome: a.nome, origem: 'avulso' }));
        }
      });
      ui.draftConvidados.forEach(c => {
        const resolved = resolverJogadorPorNome(c.nome) || { playerId: c.id, nome: c.nome, origem: 'convidado' };
        // Evita duplicar se já entrou pelo checkbox
        if (participantes.some(x => x.playerId == resolved.playerId)) return;
        participantes.push(snapshotParticipante(resolved));
      });
      if (participantes.length === 0) {
        alert('Selecione pelo menos um jogador.');
        return;
      }
      const partida = {
        id: crypto.randomUUID(),
        data,
        horaInicio,
        horaFim,
        participantes,
        times: []
      };
      if (!state.partidas) state.partidas = [];
      state.partidas.push(partida);
      save();
      ui.partidaView = 'detalhe';
      ui.partidaId = partida.id;
      render();
    }

    function removePartida(id) {
      if (!confirm('Remover esta partida e todas as estatísticas dela?')) return;
      state.partidas = state.partidas.filter(p => p.id !== id);
      state.avaliacoes = (state.avaliacoes || []).filter(a => !sameId(a.partidaId, id));
      recalcularNiveis();
      if (ui.partidaId === id) { ui.partidaView = 'lista'; ui.partidaId = null; }
      save();
      render();
    }

    function findPartida(id) {
      return (state.partidas || []).find(p => p.id === id);
    }

    function adjStat(partidaId, playerId, campo, delta) {
      const p = findPartida(partidaId);
      if (!p) return;
      const part = p.participantes.find(x => x.playerId == playerId);
      if (!part) return;
      part[campo] = Math.max(0, (part[campo] || 0) + delta);
      save();
      render();
    }

    function montarTimes(partidaId, reshuffle) {
      const p = findPartida(partidaId);
      if (!p || !p.participantes.length) return;
      const sizePer = getJogadoresPorTime();
      const n = p.participantes.length;
      const numTimes = calcNumTimes(n, sizePer);
      if (numTimes < 1) return;
      const capacities = calcTeamCapacities(n, numTimes, sizePer);
      p.participantes.forEach(part => {
        if (part.nivel === undefined) part.nivel = 3;
        if (part.goleiro === undefined) part.goleiro = false;
        part.nivel = normalizeNivel(part.nivel);
        part.nivelAvaliacao = part.nivelAvaliacao !== undefined ? normalizeNivel(part.nivelAvaliacao) : null;
      });
      const teams = Array.from({ length: numTimes }, () => []);
      const sums = Array(numTimes).fill(0);

      const teamHasGk = (ti) => teams[ti].some(id => {
        const part = p.participantes.find(x => x.playerId == id);
        return part && part.goleiro;
      });

      const pickTeam = (isGk) => {
        let best = -1;
        let bestScore = Infinity;
        for (let i = 0; i < numTimes; i++) {
          if (teams[i].length >= capacities[i]) continue;
          let score = sums[i];
          if (isGk && !teamHasGk(i)) score -= 1000;
          // Empate: prefere o time com menos jogadores (completa buracos sem afundar o nível)
          const fewer = best < 0 ? true : teams[i].length < teams[best].length;
          if (score < bestScore || (score === bestScore && fewer)) {
            bestScore = score;
            best = i;
          }
        }
        return best;
      };

      const ranked = (list) => list.map(part => {
        const base = nivelParaBalanceamento(part);
        const jitter = reshuffle ? (Math.random() - 0.5) * 2 : 0;
        return { part, rating: base + jitter };
      }).sort((a, b) => b.rating - a.rating);

      const assign = (part, rating, isGk) => {
        const i = pickTeam(isGk);
        if (i < 0) return;
        teams[i].push(part.playerId);
        sums[i] += rating;
      };

      ranked(p.participantes.filter(x => x.goleiro)).forEach(({ part, rating }) => assign(part, rating, true));
      ranked(p.participantes.filter(x => !x.goleiro)).forEach(({ part, rating }) => assign(part, rating, false));

      p.times = teams;
      save();
      render();
    }

    function pedirConfirmacao(mensagem) {
      return new Promise(resolve => {
        const old = document.getElementById('confirm-overlay');
        if (old) old.remove();
        const ov = document.createElement('div');
        ov.id = 'confirm-overlay';
        ov.className = 'confirm-overlay';
        const box = document.createElement('div');
        box.className = 'confirm-box';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        const p = document.createElement('p');
        p.textContent = mensagem;
        const actions = document.createElement('div');
        actions.className = 'confirm-actions';
        const btnNo = document.createElement('button');
        btnNo.type = 'button';
        btnNo.className = 'confirm-cancel';
        btnNo.textContent = 'Cancelar';
        const btnYes = document.createElement('button');
        btnYes.type = 'button';
        btnYes.className = 'confirm-ok';
        btnYes.textContent = 'Remover';
        actions.appendChild(btnNo);
        actions.appendChild(btnYes);
        box.appendChild(p);
        box.appendChild(actions);
        ov.appendChild(box);
        document.body.appendChild(ov);
        const close = (val) => { ov.remove(); resolve(val); };
        btnNo.onclick = () => close(false);
        btnYes.onclick = () => close(true);
        ov.addEventListener('click', (e) => { if (e.target === ov) close(false); });
      });
    }

    function htmlStatsJogador(partida, part, teamIndex, numTeams) {
      const moveSel = (numTeams > 1 && teamIndex !== undefined)
        ? `<select class="team-move-sel" title="Mover de time" onclick="event.stopPropagation()"
            onmousedown="event.stopPropagation()"
            onchange="moverJogadorParaTime(${jsArg(partida.id)},${jsArg(part.playerId)},+this.value)">
            <option value="${teamIndex}">${teamLetter(teamIndex)}</option>
            ${Array.from({ length: numTeams }, (_, i) => i === teamIndex ? '' : `<option value="${i}">${teamLetter(i)}</option>`).join('')}
          </select>`
        : '';
      return `
        <div class="stat-player" draggable="true"
          ondragstart="playerDragStart(event,${jsArg(partida.id)},${jsArg(part.playerId)})"
          ondragend="playerDragEnd(event)">
          <div class="stat-player-head">
            <span class="stat-player-name">${part.nome}${golTag(part.goleiro)} <span style="color:#555;font-size:0.6rem">Nv ${formatNivel(part.nivel)} · Av ${formatNivel(part.nivelAvaliacao)}</span></span>
            ${moveSel}
            <button class="btn-remove" onclick="event.stopPropagation();removeJogadorDaPartida(${jsArg(partida.id)},${jsArg(part.playerId)})"
              onmousedown="event.stopPropagation()" style="padding:0 4px">✕</button>
          </div>
          <div class="stat-row">
            <div class="stat-group">
              <label>G</label>
              <div class="stat-ctrl">
                <span class="stat-val">${part.gols || 0}</span>
              </div>
            </div>
            <div class="stat-group">
              <label>A</label>
              <div class="stat-ctrl">
                <span class="stat-val">${part.assistencias || 0}</span>
              </div>
            </div>
            <div class="stat-group">
              <label>D</label>
              <div class="stat-ctrl">
                <span class="stat-val">${part.defesas || 0}</span>
              </div>
            </div>
          </div>
        </div>`;
    }

    let _dragPlayer = null;

    function playerDragStart(ev, partidaId, playerId) {
      if (ev.target.closest('button, select, input')) {
        ev.preventDefault();
        return;
      }
      _dragPlayer = { partidaId, playerId };
      try {
        ev.dataTransfer.setData('text/plain', JSON.stringify(_dragPlayer));
        ev.dataTransfer.effectAllowed = 'move';
      } catch (e) { /* ignore */ }
      ev.currentTarget.classList.add('stat-player-dragging');
    }

    function playerDragEnd(ev) {
      ev.currentTarget.classList.remove('stat-player-dragging');
      document.querySelectorAll('.team-panel-dragover').forEach(el => el.classList.remove('team-panel-dragover'));
      _dragPlayer = null;
    }

    function teamDragOver(ev) {
      ev.preventDefault();
      ev.currentTarget.classList.add('team-panel-dragover');
    }

    function teamDragLeave(ev) {
      if (!ev.currentTarget.contains(ev.relatedTarget)) {
        ev.currentTarget.classList.remove('team-panel-dragover');
      }
    }

    function teamDrop(ev, partidaId, teamIndex) {
      ev.preventDefault();
      ev.currentTarget.classList.remove('team-panel-dragover');
      let data = _dragPlayer;
      try {
        const raw = ev.dataTransfer.getData('text/plain');
        if (raw) data = JSON.parse(raw);
      } catch (e) { /* ignore */ }
      if (!data || !sameId(data.partidaId, partidaId)) return;
      moverJogadorParaTime(partidaId, data.playerId, teamIndex);
      _dragPlayer = null;
    }

    function moverJogadorParaTime(partidaId, playerId, toIndex) {
      const p = findPartida(partidaId);
      if (!p) return;
      toIndex = Number(toIndex);
      const times = getTimesList(p).map(t => t.slice());
      if (toIndex < 0 || toIndex >= times.length) return;
      if (times[toIndex].some(id => id == playerId)) return;
      const cleaned = times.map(t => t.filter(id => id != playerId));
      cleaned[toIndex].push(playerId);
      p.times = cleaned;
      save();
      render();
    }

    function alocarJogadorNoMelhorTime(p, part) {
      const times = getTimesList(p).map(t => t.slice());
      if (!times.length) return;
      let best = 0;
      let bestScore = Infinity;
      times.forEach((ids, i) => {
        let score = ids.length * 1000 + somaNivelTime(p, ids);
        if (part.goleiro) {
          const hasGk = ids.some(id => p.participantes.find(x => x.playerId == id)?.goleiro);
          if (!hasGk) score -= 5000;
        }
        if (score < bestScore) {
          bestScore = score;
          best = i;
        }
      });
      times[best].push(part.playerId);
      p.times = times;
    }

    function htmlEstatisticasPartida(p) {
      const timesIds = getTimesList(p);
      if (!timesTemJogadores(p)) {
        return p.participantes.map(part => htmlStatsJogador(p, part)).join('');
      }
      const byId = id => p.participantes.find(x => x.playerId == id);
      const numTeams = timesIds.length;
      const panelHtml = (ids, ti) => {
        const parts = ids.map(byId).filter(Boolean);
        const nivel = somaNivelTime(p, ids);
        return `<div class="team-panel" style="border-color:${teamColor(ti)}"
          ondragover="teamDragOver(event)"
          ondragleave="teamDragLeave(event)"
          ondrop="teamDrop(event,${jsArg(p.id)},${ti})">
          <div class="team-panel-title" style="color:${teamColor(ti)}">Time ${teamLetter(ti)} · ${ids.length} · ${labelBalanceamentoTimes()} ${nivel}</div>
          <div class="team-panel-hint">Arraste para cá</div>
          ${parts.map(part => htmlStatsJogador(p, part, ti, numTeams)).join('') || '<div class="card-detail">vazio — solte um jogador</div>'}
        </div>`;
      };
      const chunks = [];
      for (let i = 0; i < timesIds.length; i += 2) {
        const pair = timesIds.slice(i, i + 2);
        const panels = pair.map((ids, j) => panelHtml(ids, i + j)).join('');
        const duoClass = pair.length === 2 ? ' stats-pair-row--duo' : '';
        chunks.push(`<div class="stats-pair-row${duoClass}">${panels}</div>`);
      }
      return `<div class="stats-teams-grid">${chunks.join('')}</div>
      <div class="card-detail" style="margin-top:8px">Arraste o card ou use a letra (A/B/C…) para trocar de time</div>`;
    }

    function addJogadorNaPartida(partidaId) {
      const p = findPartida(partidaId);
      if (!p) return;
      const sel = document.getElementById('sel-add-jogador-partida');
      const inp = document.getElementById('inp-add-jogador-partida');
      let novo = null;
      if (sel && sel.value) {
        const [origem, idStr, ...nomeParts] = sel.value.split('|');
        const playerId = origem === 'admin' ? getAdmin().id : idStr;
        const nome = nomeParts.join('|') || (origem === 'admin' ? adminNomeLabel() : '');
        if (p.participantes.some(x => x.playerId == playerId)) {
          alert('Esse jogador já está na partida.');
          return;
        }
        novo = snapshotParticipante({ playerId, nome, origem });
      } else if (inp && inp.value.trim()) {
        const resolved = resolverJogadorPorNome(inp.value.trim());
        if (!resolved) return;
        if (p.participantes.some(x =>
          x.playerId == resolved.playerId ||
          x.nome.toLowerCase() === resolved.nome.toLowerCase()
        )) {
          alert('Esse jogador já está na partida.');
          return;
        }
        novo = snapshotParticipante(resolved);
      } else {
        alert('Selecione um jogador ou digite um nome.');
        return;
      }
      p.participantes.push(novo);
      novo.nivel = null;
      if (timesTemJogadores(p)) {
        alocarJogadorNoMelhorTime(p, novo);
      }
      save();
      render();
    }

    async function removeJogadorDaPartida(partidaId, playerId) {
      const p = findPartida(partidaId);
      if (!p) return;
      const part = p.participantes.find(x => x.playerId == playerId);
      const nome = part?.nome || 'este jogador';
      const ok = await pedirConfirmacao(`Remover ${nome} da partida?`);
      if (!ok) return;
      p.participantes = p.participantes.filter(x => x.playerId != playerId);
      p.times = getTimesList(p).map(t => t.filter(x => x != playerId)).filter(t => t.length > 0);
      save();
      render();
    }

    function nomeParticipantePartida(partida, playerId) {
      const part = (partida?.participantes || []).find(x => sameId(x.playerId, playerId));
      return part?.nome || String(playerId).slice(0, 8);
    }

    function abrirRevisaoAvaliacoes(partidaId) {
      const p = findPartida(partidaId);
      if (!p) return;
      const old = document.getElementById('avaliacao-revisao-overlay');
      if (old) old.remove();
      const avs = (state.avaliacoes || []).filter(a => sameId(a.partidaId, partidaId));
      if (!avs.length) {
        alert('Nenhuma avaliação nesta partida.');
        return;
      }
      const pend = avs.filter(isAvaliacaoPendente);
      const ov = document.createElement('div');
      ov.id = 'avaliacao-revisao-overlay';
      ov.className = 'confirm-overlay';
      const box = document.createElement('div');
      box.className = 'confirm-box';
      box.style.maxWidth = '420px';
      box.style.maxHeight = '80vh';
      box.style.overflow = 'auto';
      box.style.textAlign = 'left';
      const title = document.createElement('p');
      title.style.fontWeight = '700';
      title.style.marginBottom = '12px';
      title.textContent = `Avaliações — ${formatDataBR(p.data)}`;
      box.appendChild(title);

      const renderAvCard = (av) => {
        const card = document.createElement('div');
        card.className = 'card';
        card.style.marginBottom = '10px';
        card.style.padding = '10px';
        const status = isAvaliacaoAprovada(av)
          ? 'Aprovada'
          : (av.rejeitadaEm ? 'Rejeitada' : 'Pendente');
        const statusColor = isAvaliacaoAprovada(av) ? '#00e676' : (av.rejeitadaEm ? '#ff8a80' : '#ff9800');
        const avaliador = nomeParticipantePartida(p, av.avaliadorId);
        let notasHtml = Object.entries(av.notas || {}).map(([id, nota]) =>
          `<div style="font-size:0.85rem;color:#ccc">• ${nomeParticipantePartida(p, id)} — ${nota}</div>`
        ).join('');
        const st = av.stats && (av.stats[av.avaliadorId] || av.stats[String(av.avaliadorId)]);
        let statsHtml = '';
        if (st) {
          statsHtml = `<div style="font-size:0.8rem;color:#888;margin-top:6px">Gols: ${st.gols || 0} · Assistências: ${st.assistencias || 0}${st.defesas != null ? ` · Defesas: ${st.defesas}` : ''}</div>`;
        }
        card.innerHTML = `
          <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:6px">
            <strong style="font-family:DM Sans,sans-serif">${avaliador}</strong>
            <span style="color:${statusColor};font-size:0.75rem;font-family:DM Sans,sans-serif">${status}</span>
          </div>
          ${notasHtml || '<div class="card-detail">Sem notas</div>'}
          ${statsHtml}
        `;
        if (isAvaliacaoPendente(av)) {
          const actions = document.createElement('div');
          actions.style.display = 'flex';
          actions.style.gap = '8px';
          actions.style.marginTop = '10px';
          const btnOk = document.createElement('button');
          btnOk.type = 'button';
          btnOk.className = 'btn-add';
          btnOk.style.flex = '1';
          btnOk.style.margin = '0';
          btnOk.textContent = 'Aprovar';
          btnOk.onclick = () => decidirAvaliacoes([av.id], 'aprovar', partidaId);
          const btnNo = document.createElement('button');
          btnNo.type = 'button';
          btnNo.className = 'btn-secondary';
          btnNo.style.flex = '1';
          btnNo.style.margin = '0';
          btnNo.style.color = '#ff8a80';
          btnNo.textContent = 'Rejeitar';
          btnNo.onclick = () => decidirAvaliacoes([av.id], 'rejeitar', partidaId);
          actions.appendChild(btnOk);
          actions.appendChild(btnNo);
          card.appendChild(actions);
        }
        return card;
      };

      pend.forEach(av => box.appendChild(renderAvCard(av)));
      avs.filter(a => !isAvaliacaoPendente(a)).forEach(av => box.appendChild(renderAvCard(av)));

      const footer = document.createElement('div');
      footer.className = 'confirm-actions';
      footer.style.marginTop = '12px';
      if (pend.length > 1) {
        const btnAll = document.createElement('button');
        btnAll.type = 'button';
        btnAll.className = 'confirm-ok';
        btnAll.textContent = `Aprovar todas (${pend.length})`;
        btnAll.onclick = () => decidirAvaliacoes(pend.map(a => a.id), 'aprovar', partidaId);
        footer.appendChild(btnAll);
      }
      const btnClose = document.createElement('button');
      btnClose.type = 'button';
      btnClose.className = 'confirm-cancel';
      btnClose.textContent = 'Fechar';
      btnClose.onclick = () => ov.remove();
      footer.appendChild(btnClose);
      box.appendChild(footer);
      ov.appendChild(box);
      ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
      document.body.appendChild(ov);
    }

    async function decidirAvaliacoes(avaliacaoIds, acao, partidaId) {
      if (!avaliacaoIds?.length) return;
      try {
        await approveAvaliacoes(avaliacaoIds, acao);
        state = await load();
        const ov = document.getElementById('avaliacao-revisao-overlay');
        if (ov) ov.remove();
        render();
        alert(acao === 'aprovar'
          ? (avaliacaoIds.length > 1 ? 'Avaliações aprovadas. Av e estatísticas atualizados.' : 'Avaliação aprovada. Av e estatísticas atualizados.')
          : 'Avaliação rejeitada.');
        const aindaPend = (state.avaliacoes || []).some(a => sameId(a.partidaId, partidaId) && isAvaliacaoPendente(a));
        const aindaAlguma = (state.avaliacoes || []).some(a => sameId(a.partidaId, partidaId));
        if (aindaAlguma) abrirRevisaoAvaliacoes(partidaId);
        else if (!aindaPend) { /* modal já fechado */ }
      } catch (e) {
        alert('Falha ao ' + (acao === 'aprovar' ? 'aprovar' : 'rejeitar') + ': ' + (e.message || e));
      }
    }

    function somaNivelTime(partida, ids) {
      return ids.reduce((sum, id) => {
        const part = partida.participantes.find(x => x.playerId == id);
        return sum + nivelParaBalanceamento(part);
      }, 0);
    }

    function renderPartidas() {
      const root = document.getElementById('partidas-root');
      if (!root) return;

      if (ui.partidaView === 'nova') {
        const diaPelada = getPeladaDiaSemana();
        const warn = ui.draftData && !isDiaPelada(ui.draftData, diaPelada)
          ? `<div class="hint-warn">⚠ Esta data não é ${labelDiaSemana(diaPelada).toLowerCase()}</div>` : '';
        const adminAp = getAdminPerfil();
        const adminHtml = `<label class="chk-row"><input type="checkbox" ${ui.draftSelecionados['admin:' + getAdmin().id] ? 'checked' : ''} onchange="toggleDraftPlayer('admin:${getAdmin().id}')"><span class="chk-row-nome">${adminNomeLabel()}${golTag(adminAp.goleiro)}</span><span class="chk-row-meta chk-row-meta--admin">admin · Nv ${formatNivel(adminAp.nivel)} · Av ${formatNivel(adminAp.nivelAvaliacao)}</span></label>`;
        const mensHtml = state.mensalistas.length
          ? state.mensalistas.map(m =>
            `<label class="chk-row"><input type="checkbox" ${ui.draftSelecionados['m:' + m.id] ? 'checked' : ''} onchange="toggleDraftPlayer('m:${m.id}')"><span class="chk-row-nome">${m.nome}${golTag(m.goleiro)}</span><span class="chk-row-meta">mens. · Nv ${formatNivel(m.nivel)} · Av ${formatNivel(m.nivelAvaliacao)}</span></label>`
          ).join('')
          : '<p style="font-family:DM Sans,sans-serif;color:#555;font-size:0.85rem">Nenhum mensalista cadastrado</p>';
        const avHtml = state.avulsos.length
          ? state.avulsos.map(a =>
            `<label class="chk-row"><input type="checkbox" ${ui.draftSelecionados['a:' + a.id] ? 'checked' : ''} onchange="toggleDraftPlayer('a:${a.id}')"><span class="chk-row-nome">${a.nome}${golTag(a.goleiro)}</span><span class="chk-row-meta">avulso · Nv ${formatNivel(a.nivel)} · Av ${formatNivel(a.nivelAvaliacao)}</span></label>`
          ).join('')
          : '';
        const convHtml = ui.draftConvidados.map(c =>
          `<div class="row-item"><span>${c.nome} <span style="color:#555;font-size:0.7rem">(convidado)</span></span><button class="btn-remove" onclick="removeDraftConvidado(${jsArg(c.id)})">✕</button></div>`
        ).join('');

        root.innerHTML = `
          <button class="btn-back" onclick="voltarListaPartidas()">← Voltar</button>
          <div class="card">
            <div class="section-title">NOVA PARTIDA</div>
            <div style="display:flex;flex-direction:column;gap:10px;font-family:'DM Sans',sans-serif;font-size:0.9rem;min-width:0;max-width:100%" class="cfg-form">
              <div>
                <div class="card-label">Data (dd/mm/aaaa)</div>
                <input type="text" class="fut-input" id="inp-partida-data" inputmode="numeric" placeholder="dd/mm/aaaa" value="${isoToBR(ui.draftData) || ''}" onchange="setDraftDataFromInput()" onblur="setDraftDataFromInput()">
                ${warn}
                <button type="button" class="btn-secondary" style="margin-top:8px;margin-bottom:0" onclick="usarProximaPelada()">Próxima ${labelDiaSemanaCurto(diaPelada)}</button>
              </div>
              <div class="grid2">
                <div>
                  <div class="card-label">Início (24h)</div>
                  <input type="text" class="fut-input" id="inp-partida-inicio" inputmode="numeric" placeholder="${getPeladaHoraInicio()}" value="${ui.draftHoraInicio}" maxlength="5">
                </div>
                <div>
                  <div class="card-label">Fim (24h)</div>
                  <input type="text" class="fut-input" id="inp-partida-fim" inputmode="numeric" placeholder="${getPeladaHoraFim()}" value="${ui.draftHoraFim}" maxlength="5">
                </div>
              </div>
            </div>
          </div>
          <div class="card">
            <div class="section-title">JOGADORES</div>
            ${adminHtml}
            ${mensHtml}
            ${avHtml ? '<div class="section-title" style="margin-top:14px">AVULSOS DO MÊS</div>' + avHtml : ''}
            <div class="section-title" style="margin-top:14px">CONVIDADOS</div>
            <div class="input-row">
              <input class="fut-input" id="inp-convidado" placeholder="Nome do convidado..." onkeydown="if(event.key==='Enter')addDraftConvidado()">
              <button class="btn-add" onclick="addDraftConvidado()">+</button>
            </div>
            ${convHtml}
          </div>
          <button class="btn-add" style="width:100%" onclick="criarPartida()">Criar Partida</button>
        `;
        return;
      }

      if (ui.partidaView === 'detalhe') {
        const p = findPartida(ui.partidaId);
        if (!p) {
          ui.partidaView = 'lista';
          renderPartidas();
          return;
        }
        const totalGols = p.participantes.reduce((s, x) => s + (x.gols || 0), 0);
        const maxPorTime = getJogadoresPorTime();
        const timesIds = getTimesList(p);
        const hasTimes = timesTemJogadores(p);
        let timesHtml = '';
        if (hasTimes) {
          const nomeDe = id => {
            const part = p.participantes.find(x => x.playerId == id);
            if (!part) return '?';
            return `${part.nome}${golTag(part.goleiro)} <span style="color:#555;font-size:0.7rem">Nv ${formatNivel(part.nivel)} · Av ${formatNivel(part.nivelAvaliacao)}</span>`;
          };
          timesHtml = `<div class="teams-wrap">${timesIds.map((ids, ti) => {
            const nivel = somaNivelTime(p, ids);
            return `<div class="card" style="border-color:${teamColor(ti)}">
              <div class="card-label" style="color:${teamColor(ti)}">Time ${teamLetter(ti)} · ${ids.length} · ${labelBalanceamentoTimes()} ${Math.round(nivel * 10) / 10}</div>
              ${ids.map(id => `<div class="row-item"><span>${nomeDe(id)}</span></div>`).join('') || '<div class="card-detail">vazio</div>'}
            </div>`;
          }).join('')}</div>
          <div class="card-detail" style="margin:0 0 10px">${timesIds.length} times · ideal ${maxPorTime}/time · ${p.participantes.length} jogadores</div>`;
        }

        const idsNaPartida = new Set(p.participantes.map(x => String(x.playerId)));
        const opcoesAdd = [];
        if (!idsNaPartida.has(String(getAdmin().id))) {
          opcoesAdd.push(`<option value="admin|${getAdmin().id}|${adminNomeLabel()}">${adminNomeLabel()} (admin)</option>`);
        }
        state.mensalistas.forEach(m => {
          if (!idsNaPartida.has(String(m.id))) {
            opcoesAdd.push(`<option value="mensalista|${m.id}|${m.nome}">${m.nome} (mensalista)</option>`);
          }
        });
        state.avulsos.forEach(a => {
          if (!idsNaPartida.has(String(a.id))) {
            opcoesAdd.push(`<option value="avulso|${a.id}|${a.nome}">${a.nome} (avulso)</option>`);
          }
        });

        root.innerHTML = `
          <button class="btn-back" onclick="voltarListaPartidas()">← Voltar</button>
          <div class="card">
            <div class="section-title">${formatDataBRLong(p.data).toUpperCase()}</div>
            <div class="card-detail">${p.horaInicio || '21:00'} — ${p.horaFim || '23:00'} · ${p.participantes.length} jogadores</div>
            <div class="card-value" style="font-size:1.4rem;margin-top:8px">⚽ ${totalGols} gols</div>
          </div>
          <button class="btn-add" style="background:#25d366;color:#000;width:100%;margin-bottom:8px" onclick="copiarPartidaWhats(${jsArg(p.id)})">💬 Copiar Partida p/ WhatsApp</button>
          <button class="btn-add" style="background:#5865F2;color:#fff;width:100%;margin-bottom:8px" onclick="copiarLinkAvaliacao(${jsArg(p.id)})">⭐ Link de avaliação</button>
          ${(() => {
            const pend = (state.avaliacoes || []).filter(a => sameId(a.partidaId, p.id) && isAvaliacaoPendente(a));
            const aprov = (state.avaliacoes || []).filter(a => sameId(a.partidaId, p.id) && isAvaliacaoAprovada(a));
            const rej = (state.avaliacoes || []).filter(a => sameId(a.partidaId, p.id) && a.rejeitadaEm);
            let btns = '';
            if (pend.length) {
              btns += `<button class="btn-add" style="background:#ff9800;color:#000;width:100%;margin-bottom:8px" onclick="abrirRevisaoAvaliacoes(${jsArg(p.id)})">📋 Revisar avaliações (${pend.length} pendente${pend.length !== 1 ? 's' : ''})</button>`;
            } else if (aprov.length || rej.length) {
              btns += `<button class="btn-secondary" style="width:100%;margin-bottom:8px" onclick="abrirRevisaoAvaliacoes(${jsArg(p.id)})">📋 Avaliações (${aprov.length} aprovada${aprov.length !== 1 ? 's' : ''}${rej.length ? `, ${rej.length} rejeitada${rej.length !== 1 ? 's' : ''}` : ''})</button>`;
            }
            return btns;
          })()}
          <button class="btn-secondary" style="color:#ff8a80" onclick="resetarAvaliacoesPartida(${jsArg(p.id)})">Resetar avaliações desta partida</button>
          <div class="card" style="margin-bottom:8px;padding:12px">
            <div class="section-title" style="margin-bottom:8px">BALANCEAR TIMES POR</div>
            <div class="bal-toggle" style="margin-bottom:6px">
              <button type="button" class="${getBalanceamentoTimes() === 'nivel' ? 'active' : ''}" onclick="setBalanceamentoTimes('nivel')">Nv (manual)</button>
              <button type="button" class="${getBalanceamentoTimes() === 'avaliacao' ? 'active active-av' : ''}" onclick="setBalanceamentoTimes('avaliacao')">Av (média)</button>
            </div>
            <div class="card-detail">Av = average (média das avaliações). Sem Av no jogador, usa o Nv.</div>
          </div>
          <button class="btn-secondary" onclick="montarTimes(${jsArg(p.id)}, false)">${hasTimes ? 'Remontar times' : 'Montar times'} · ${labelBalanceamentoTimes()}</button>
          ${hasTimes ? `<button class="btn-secondary" onclick="montarTimes(${jsArg(p.id)}, true)">Embaralhar de novo · ${labelBalanceamentoTimes()}</button>` : ''}
          ${timesHtml}
          <div class="card">
            <div class="section-title">ADICIONAR JOGADOR</div>
            ${opcoesAdd.length ? `<select class="fut-input" id="sel-add-jogador-partida" style="margin-bottom:8px"><option value="">Selecionar cadastrado...</option>${opcoesAdd.join('')}</select>` : '<input type="hidden" id="sel-add-jogador-partida" value="">'}
            <div class="input-row" style="margin-bottom:0">
              <input class="fut-input" id="inp-add-jogador-partida" placeholder="Ou digite um nome..." onkeydown="if(event.key==='Enter')addJogadorNaPartida(${jsArg(p.id)})">
              <button class="btn-add" onclick="addJogadorNaPartida(${jsArg(p.id)})">+</button>
            </div>
          </div>
          <div class="card">
            <div class="section-title">ESTATÍSTICAS</div>
            <div class="card-detail" style="margin-bottom:8px">G/A/D vêm das avaliações aprovadas (somente leitura)</div>
            ${htmlEstatisticasPartida(p)}
          </div>
          <button class="btn-add" style="background:#ff5252;color:#fff;width:100%" onclick="removePartida(${jsArg(p.id)})">Remover partida</button>
        `;
        return;
      }

      const partidas = [...(state.partidas || [])].sort((a, b) => b.data.localeCompare(a.data) || b.id - a.id);
      root.innerHTML = `
        <button class="btn-add" style="width:100%;margin-bottom:12px" onclick="abrirNovaPartida()">+ Nova Partida</button>
        ${partidas.length === 0
          ? `<div class="card empty-state"><div class="icon">⚽</div><p>Nenhuma partida ainda. Crie a primeira (${labelPeladaResumo()}).</p></div>`
          : partidas.map(p => {
            const gols = p.participantes.reduce((s, x) => s + (x.gols || 0), 0);
            return `<div class="card clickable" onclick="abrirDetalhePartida(${jsArg(p.id)})">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <div>
                  <div class="section-title" style="margin-bottom:4px">${formatDataBRLong(p.data).toUpperCase()}</div>
                  <div class="card-detail">${p.horaInicio || '21:00'}–${p.horaFim || '23:00'} · ${p.participantes.length} jogadores</div>
                </div>
                <div class="card-value green" style="font-size:1.3rem">${gols} G</div>
              </div>
            </div>`;
          }).join('')
        }
      `;
    }

    function setRankingFiltro(f) {
      ui.rankingFiltro = f;
      if (f === 'partida') {
        const partidas = [...(state.partidas || [])].sort((a, b) => b.data.localeCompare(a.data));
        if (!ui.rankingPartidaId && partidas[0]) ui.rankingPartidaId = partidas[0].id;
      }
      render();
    }
    function onRankingPartidaChange() {
      const sel = document.getElementById('rank-partida-select');
      ui.rankingPartidaId = sel ? sel.value : null;
      render();
    }

    function renderRanking() {
      ['mensal', 'partida', 'total'].forEach(f => {
        const btn = document.getElementById('rank-filtro-' + f);
        if (btn) btn.classList.toggle('active', ui.rankingFiltro === f);
      });
      const wrap = document.getElementById('rank-partida-select-wrap');
      const sel = document.getElementById('rank-partida-select');
      if (wrap && sel) {
        wrap.style.display = ui.rankingFiltro === 'partida' ? '' : 'none';
        if (ui.rankingFiltro === 'partida') {
          const partidas = [...(state.partidas || [])].sort((a, b) => b.data.localeCompare(a.data));
          sel.innerHTML = partidas.length
            ? partidas.map(p => `<option value="${p.id}" ${p.id === ui.rankingPartidaId ? 'selected' : ''}>${formatDataBR(p.data)}</option>`).join('')
            : '<option value="">Nenhuma partida</option>';
        }
      }
      const titulo = document.getElementById('rank-titulo');
      const lista = document.getElementById('rank-lista');
      if (!titulo || !lista) return;
      const labels = { mensal: `MENSAL — ${state.mesAno || obterMesAnoAtual()}`, partida: 'POR PARTIDA', total: 'TOTAL' };
      titulo.textContent = labels[ui.rankingFiltro] || 'RANKING';
      const rows = agregaParticipantes(getPartidasFiltradasRanking());
      if (!rows.length) {
        lista.innerHTML = `<div class="empty-state"><div class="icon">🏆</div><p>Sem estatísticas neste filtro</p></div>`;
        return;
      }
      lista.innerHTML = rows.map((r, i) => `
        <div class="row-item">
          <div style="display:flex;align-items:center;gap:10px">
            <span class="rank-pos">${i + 1}</span>
            <div>
              <div style="font-family:'DM Sans',sans-serif">${r.nome}</div>
              <div class="rank-stats" style="text-align:left">${r.jogos} jogo${r.jogos !== 1 ? 's' : ''}</div>
            </div>
          </div>
          <div class="rank-stats">
            <div style="font-family:'Bebas Neue',sans-serif;font-size:1.1rem;color:#00e676">${r.pontos} pts</div>
            <div>G ${r.gols} · A ${r.assistencias} · D ${r.defesas}</div>
          </div>
        </div>
      `).join('');
    }

    function copyText(txt, okMsg) {
      navigator.clipboard.writeText(txt).then(() => {
        alert(okMsg);
      }).catch(() => {
        const textarea = document.createElement('textarea');
        textarea.value = txt;
        textarea.style.position = 'fixed';
        document.body.appendChild(textarea);
        textarea.select();
        try {
          document.execCommand('copy');
          alert(okMsg);
        } catch (e) {
          alert('Não foi possível copiar automaticamente.');
        }
        document.body.removeChild(textarea);
      });
    }

    function copiarPartidaWhats(id) {
      const p = findPartida(id);
      if (!p) return;
      const sorted = [...p.participantes].sort((a, b) => pontosDe(b) - pontosDe(a) || (b.gols || 0) - (a.gols || 0));
      const artilheiro = [...p.participantes].sort((a, b) => (b.gols || 0) - (a.gols || 0))[0];
      let txt = `⚽ *PARTIDA — ${formatDataBR(p.data)}*\n`;
      txt += `🕐 ${p.horaInicio || '21:00'}–${p.horaFim || '23:00'}\n\n`;
      if (artilheiro && (artilheiro.gols || 0) > 0) {
        txt += `🥇 *Artilheiro:* ${artilheiro.nome} — ${artilheiro.gols} gol${artilheiro.gols !== 1 ? 's' : ''}\n\n`;
      }
      if (timesTemJogadores(p)) {
        const nome = pid => {
          const part = p.participantes.find(x => x.playerId == pid);
          if (!part) return '?';
          return part.goleiro ? `${part.nome} (GOL)` : part.nome;
        };
        const timesIds = getTimesList(p);
        const emojis = ['🔵', '🟣', '🟢', '🟠', '🔴', '🩵'];
        timesIds.forEach((ids, ti) => {
          const ra = somaNivelTime(p, ids);
          txt += `${emojis[ti % emojis.length]} *Time ${teamLetter(ti)}* (${labelBalanceamentoTimes()} ${ra}): ${ids.map(nome).join(', ')}\n`;
        });
        txt += `\n`;
      }
      txt += `📊 *Stats:*\n`;
      sorted.forEach(part => {
        txt += ` - ${part.nome}: ${part.gols || 0}G ${part.assistencias || 0}A ${part.defesas || 0}D\n`;
      });
      copyText(txt, 'Resumo da partida copiado! Só colar no WhatsApp. 😉');
    }

    function copiarRankingWhats() {
      const rows = agregaParticipantes(getPartidasFiltradasRanking());
      const labels = { mensal: state.mesAno || obterMesAnoAtual(), partida: 'partida', total: 'geral' };
      let txt = `🏆 *RANKING ${(labels[ui.rankingFiltro] || '').toUpperCase()}*\n`;
      if (ui.rankingFiltro === 'partida') {
        const p = findPartida(ui.rankingPartidaId);
        if (p) txt += `📅 ${formatDataBR(p.data)}\n`;
      }
      txt += `\n`;
      if (!rows.length) {
        txt += `Sem estatísticas ainda.\n`;
      } else {
        rows.slice(0, 15).forEach((r, i) => {
          txt += `${i + 1}. *${r.nome}* — ${r.pontos} pts (${r.gols}G ${r.assistencias}A ${r.defesas}D)\n`;
        });
        txt += `\n_Pontuação: Gol=3 · Assist=2 · Defesa=1_`;
      }
      copyText(txt, 'Ranking copiado! Só colar no WhatsApp. 😉');
    }

    function toggleMens(id) { state.mensalistas = state.mensalistas.map(m => m.id === id ? { ...m, pago: !m.pago } : m); save(); render(); }
    function removeMens(id) { if (!confirm('Remover?')) return; state.mensalistas = state.mensalistas.filter(m => m.id !== id); save(); render(); }
    function addMensalista() {
      const i = document.getElementById('inp-mens'), n = i.value.trim(); if (!n) return;
      state.mensalistas.push({ id: crypto.randomUUID(), nome: n, pago: false, nivel: 3, nivelAvaliacao: null, goleiro: false }); i.value = ''; save(); render();
    }
    function addAvulso() {
      const i = document.getElementById('inp-av'), n = i.value.trim(); if (!n) return;
      const s = document.getElementById('sel-av').value;
      state.avulsos.push({ id: crypto.randomUUID(), nome: n, status: s, nivel: 3, nivelAvaliacao: null, goleiro: false }); i.value = ''; save(); render();
    }
    function toggleAv(id) { state.avulsos = state.avulsos.map(a => a.id === id ? { ...a, status: a.status === 'pago' ? 'pendente' : 'pago' } : a); save(); render(); }
    function removeAv(id) { if (!confirm('Remover?')) return; state.avulsos = state.avulsos.filter(a => a.id !== id); save(); render(); }
    function editCusto() { const v = prompt('Custo da quadra (R$):', state.custoQuadra); if (v !== null && !isNaN(+v) && +v >= 0) { state.custoQuadra = +v; save(); render(); } }
    function editSaldo() { const v = prompt('Saldo do mês anterior (R$):', state.saldoAnterior); if (v !== null && !isNaN(+v)) { state.saldoAnterior = +v; save(); render(); } }
    function editAvulsosAnt() { const v = prompt('Qtd avulsos pendentes mês anterior:', state.avulsosPendentesAnt); if (v !== null && !isNaN(+v)) { state.avulsosPendentesAnt = +v; save(); render(); } }
    function editMesAno() { setTab('ajustes'); }

    function updateMesVigente() {
      const cfgMes = document.getElementById('cfg-mes');
      const cfgAno = document.getElementById('cfg-ano');
      const mes = cfgMes ? parseInt(cfgMes.value, 10) : 0;
      let ano = cfgAno ? parseInt(cfgAno.value, 10) : new Date().getFullYear();
      if (isNaN(ano) || ano < 2020) ano = new Date().getFullYear();
      state.mesAno = formatMesAno(isNaN(mes) ? 0 : mes, ano);
      save();
      render();
    }

    function updatePix() {
      const val = document.getElementById('cfg-pix').value.trim();
      state.chavePix = val;
      save();
      render();
    }

    function updateAdminNome() {
      const el = document.getElementById('cfg-admin-nome');
      const ap = getAdminPerfil();
      state.adminPerfil = { ...ap, nome: el ? el.value.trim() : '' };
      save();
      render();
    }

    function updateJogadoresPorTime() {
      const el = document.getElementById('cfg-jogadores-por-time');
      const v = el ? parseInt(el.value, 10) : 5;
      state.jogadoresPorTime = (!v || isNaN(v) || v < 1) ? 5 : Math.min(11, Math.max(1, v));
      save();
      render();
    }

    function updateTaxas() {
      const valMensalidade = parseFloat(document.getElementById('cfg-mensalidade').value);
      const valAvulso = parseFloat(document.getElementById('cfg-avulso').value);
      if (!isNaN(valMensalidade) && valMensalidade >= 0) state.valorMensalidade = valMensalidade;
      if (!isNaN(valAvulso) && valAvulso >= 0) state.valorAvulso = valAvulso;
      save();
      render();
    }

    function updatePeladaConfig() {
      const diaEl = document.getElementById('cfg-pelada-dia');
      const iniEl = document.getElementById('cfg-pelada-inicio');
      const fimEl = document.getElementById('cfg-pelada-fim');
      const dataEl = document.getElementById('cfg-pelada-data-inicio');
      const dia = diaEl ? parseInt(diaEl.value, 10) : 3;
      state.peladaDiaSemana = (!isNaN(dia) && dia >= 0 && dia <= 6) ? dia : 3;
      const ini = iniEl ? normalizeHora(iniEl.value) : null;
      const fim = fimEl ? normalizeHora(fimEl.value) : null;
      if (ini) state.peladaHoraInicio = ini;
      if (fim) state.peladaHoraFim = fim;
      const dataRaw = dataEl ? dataEl.value.trim() : '';
      if (!dataRaw) {
        state.peladaDataInicio = '';
      } else {
        const iso = brToISO(dataRaw);
        if (!iso) {
          alert('Data de início inválida. Use dd/mm/aaaa.');
          return;
        }
        state.peladaDataInicio = iso;
      }
      save();
      render();
    }

    function addDebito() {
      const descEl = document.getElementById('inp-debito-desc');
      const valEl = document.getElementById('inp-debito-valor');
      const descricao = descEl ? descEl.value.trim() : '';
      const valor = valEl ? parseFloat(valEl.value) : NaN;
      if (!descricao) { alert('Informe a descrição do débito.'); return; }
      if (isNaN(valor) || valor <= 0) { alert('Informe um valor maior que zero.'); return; }
      if (!Array.isArray(state.debitos)) state.debitos = [];
      state.debitos.push({ id: crypto.randomUUID(), descricao, valor });
      state.outrosDebitos = (+state.outrosDebitos || 0) + valor;
      if (descEl) descEl.value = '';
      if (valEl) valEl.value = '';
      save();
      render();
    }

    function removeDebito(id) {
      if (!confirm('Remover este débito? O valor volta para o caixa.')) return;
      const item = (state.debitos || []).find(d => d.id === id);
      if (!item) return;
      state.debitos = state.debitos.filter(d => d.id !== id);
      state.outrosDebitos = Math.max(0, (+state.outrosDebitos || 0) - (+item.valor || 0));
      save();
      render();
    }

    function fecharHistoricoDebitos() {
      const ov = document.getElementById('hist-debitos-overlay');
      if (ov) ov.remove();
    }

    function abrirHistoricoDebitos() {
      fecharHistoricoDebitos();
      const mesAtual = state.mesAno || obterMesAnoAtual();
      const atuais = state.debitos || [];
      const hist = state.debitosHistorico || [];

      let bodyHtml = '';
      if (atuais.length) {
        const totalAtual = atuais.reduce((s, d) => s + (+d.valor || 0), 0);
        bodyHtml += `<div class="hist-mes-titulo">${mesAtual} (atual) — ${brl(totalAtual)}</div>`;
        bodyHtml += atuais.map(d =>
          `<div class="row-item"><span style="font-family:'DM Sans',sans-serif">${d.descricao}</span><span class="red" style="font-family:'DM Sans',sans-serif">${brl(d.valor)}</span></div>`
        ).join('');
      }
      hist.forEach(h => {
        bodyHtml += `<div class="hist-mes-titulo">${h.mesAno || 'Mês'} — ${brl(h.total || 0)}</div>`;
        bodyHtml += (h.itens || []).map(d =>
          `<div class="row-item"><span style="font-family:'DM Sans',sans-serif">${d.descricao}</span><span class="red" style="font-family:'DM Sans',sans-serif">${brl(d.valor)}</span></div>`
        ).join('');
      });
      if (!bodyHtml) {
        bodyHtml = `<div class="hist-empty">Nenhum débito no histórico ainda.<br>Ao iniciar um novo mês, os débitos do período são arquivados aqui.</div>`;
      }

      const ov = document.createElement('div');
      ov.id = 'hist-debitos-overlay';
      ov.className = 'confirm-overlay';
      ov.innerHTML = `
        <div class="confirm-box hist-debitos-box" role="dialog" aria-modal="true" aria-label="Histórico de débitos">
          <div class="hist-title">Histórico de débitos</div>
          <div class="hist-debitos-body">${bodyHtml}</div>
          <div class="confirm-actions">
            <button type="button" class="confirm-cancel" onclick="fecharHistoricoDebitos()">Fechar</button>
          </div>
        </div>`;
      document.body.appendChild(ov);
      ov.addEventListener('click', (e) => { if (e.target === ov) fecharHistoricoDebitos(); });
    }

    async function exportarBackup() {
      try {
        const backup = await exportBackupJson();
        const json = JSON.stringify(backup, null, 2);
        copyText(json, 'Backup da nuvem copiado para a área de transferência!');
      } catch (error) {
        console.error(error);
        alert('Não foi possível exportar o backup da nuvem.');
      }
    }

    async function importarBackup() {
      const el = document.getElementById('inp-import-backup');
      const btn = document.getElementById('btn-import-backup');
      const statusEl = document.getElementById('import-backup-status');
      const texto = (el?.value || '').trim();
      if (statusEl) { statusEl.style.display = 'none'; statusEl.textContent = ''; }
      if (!texto) {
        const msg = 'Cole o JSON de backup no campo acima e toque em Importar Backup.';
        if (statusEl) { statusEl.style.display = ''; statusEl.textContent = msg; }
        else alert(msg);
        el?.focus();
        return;
      }
      const btnLabel = btn?.textContent || '';
      if (btn) { btn.disabled = true; btn.textContent = 'Importando…'; }
      try {
        const parsed = JSON.parse(texto);
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.mensalistas)) {
          throw new Error('Formato de backup inválido (falta a lista mensalistas).');
        }
        await importBackupJson(parsed);
        if (el) el.value = '';
        state = await load();
        render();
        alert('Backup importado com sucesso!');
      } catch (e) {
        console.error(e);
        const msg = 'Erro ao importar o backup: ' + (e.message || e);
        if (statusEl) { statusEl.style.display = ''; statusEl.textContent = msg; }
        else alert(msg);
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = btnLabel || '📤 Importar Backup'; }
      }
    }

    async function renderFutSelector() {
      const sel = document.getElementById('fut-selector');
      if (!sel || !state?.meta?.futId) return;
      try {
        const futs = await listMyFuts();
        sel.innerHTML = futs.map((f) =>
          `<option value="${f.id}"${f.id === state.meta.futId ? ' selected' : ''}>${f.nome}</option>`
        ).join('');
      } catch (e) {
        console.warn(e);
      }
    }

    async function trocarFut(futId) {
      if (!futId || futId === state?.meta?.futId) return;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const meta = await switchFut(futId, session?.user?.id);
        setActiveFutMeta(meta);
        ui.partidaView = 'lista';
        ui.partidaId = null;
        state = await load();
        render();
      } catch (e) {
        console.error(e);
        alert('Erro ao trocar de fut: ' + (e.message || e));
        renderFutSelector();
      }
    }

    async function criarNovoFut() {
      try {
        const meta = await promptCreateFut();
        if (!meta) return;
        setActiveFutMeta(meta);
        ui.partidaView = 'lista';
        ui.partidaId = null;
        state = await load();
        render();
      } catch (e) {
        if (e.message === 'cancelled') return;
        console.error(e);
        alert('Erro ao criar fut: ' + (e.message || e));
      }
    }

    async function deslogar() {
      try {
        await logout();
        setActiveFutMeta(null);
        location.reload();
      } catch (e) {
        console.error(e);
        alert('Erro ao sair: ' + (e.message || e));
      }
    }

    async function apagarFutAtual() {
      const futId = state?.meta?.futId;
      const futNome = state?.meta?.futNome || 'este fut';
      if (!futId) {
        alert('Nenhum fut ativo.');
        return;
      }
      const msg = `Apagar "${futNome}"?\n\nEsta ação é irreversível. Serão removidos caixa, elenco, partidas e avaliações deste fut.`;
      const ok = await pedirConfirmacao(msg);
      if (!ok) return;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id;
        await deleteFut(futId);
        if (userId) {
          const key = `futmgr_v2_fut_${userId}`;
          if (localStorage.getItem(key) === futId) localStorage.removeItem(key);
        }
        const restantes = await listMyFuts();
        if (restantes.length > 0) {
          await activateFut(restantes[0].id, userId);
        } else if (session) {
          await ensureActiveFut(session);
        } else {
          setActiveFutMeta(null);
        }
        ui.partidaView = 'lista';
        ui.partidaId = null;
        state = await load();
        render();
      } catch (e) {
        console.error(e);
        alert('Erro ao apagar fut: ' + (e.message || e));
      }
    }

    function copiarResumoWhats() {
      const { mensalistas, avulsos, custoQuadra, saldoAnterior, avulsosPendentesAnt, valorMensalidade, valorAvulso, mesAno, debitos, outrosDebitos } = state;
      const pagos = mensalistas.filter(m => m.pago), pend = mensalistas.filter(m => !m.pago);
      const avP = avulsos.filter(a => a.status === 'pago'), avPend = avulsos.filter(a => a.status === 'pendente');
      const totalMens = pagos.length * valorMensalidade;
      const totalAvP = avP.length * valorAvulso;
      const totalAvPend = avPend.length * valorAvulso;
      const totalDebitos = +outrosDebitos || 0;
      const totalRecebidoMes = avulsosPendentesAnt * valorAvulso + totalMens + totalAvP;
      const totalRec = saldoAnterior + totalRecebidoMes;
      const lucro = totalRec - custoQuadra - totalDebitos;
      const aRec = pend.length * valorMensalidade + totalAvPend;
      const pct = mensalistas.length ? Math.round((pagos.length / mensalistas.length) * 100) : 0;

      let txt = `⚽ *FUT MANAGER - RESUMO FINANCEIRO* ⚽\n`;
      txt += `📅 *Futsal Quarta — ${mesAno || obterMesAnoAtual()}*\n\n`;
      txt += `💵 *Valor em Caixa:* ${brl(lucro)}\n`;
      txt += `💰 *Saldo Anterior:* ${brl(saldoAnterior)}\n`;
      txt += `💰 *Total Recebido no Mês:* ${brl(totalRecebidoMes)}\n`;
      txt += `🏟️ *Custo da Quadra:* ${brl(custoQuadra)}\n`;
      if (totalDebitos > 0) {
        txt += `🧾 *Outros Débitos:* ${brl(totalDebitos)}\n`;
        (debitos || []).forEach(d => {
          txt += ` - ${d.descricao}: ${brl(d.valor)}\n`;
        });
      }
      txt += `⏳ *A Receber:* ${brl(aRec)}\n\n`;
      txt += `👥 *Mensalistas:* ${pagos.length} de ${mensalistas.length} pagos (${pct}%)\n`;
      txt += `⚡ *Avulsos Pagos:* ${avP.length} (${brl(totalAvP)})\n`;

      if (pend.length > 0 || avPend.length > 0) {
        txt += `\n⚠️ *PENDENTES DE PAGAMENTO:*\n`;
        if (pend.length > 0) {
          txt += `*Mensalistas:*\n`;
          pend.forEach(m => {
            txt += ` - ${m.nome} (${brl(valorMensalidade)})\n`;
          });
        }
        if (avPend.length > 0) {
          txt += `*Avulsos:*\n`;
          avPend.forEach(a => {
            txt += ` - ${a.nome} (${brl(valorAvulso)})\n`;
          });
        }
      }

      copyText(txt, 'Resumo formatado copiado! Só colar no grupo do WhatsApp. 😉');
    }

    function copiarMensalistasWhats() {
      const { mensalistas, valorMensalidade, mesAno } = state;
      const pagos = mensalistas.filter(m => m.pago);
      const pend = mensalistas.filter(m => !m.pago);

      let txt = `👥 *MENSALISTAS - STATUS DE PAGAMENTO* ⚽\n`;
      txt += `📅 *Período:* ${mesAno || obterMesAnoAtual()}\n`;
      txt += `💵 *Mensalidade:* ${brl(valorMensalidade)}\n\n`;

      txt += `✅ *PAGOS (${pagos.length}):*\n`;
      if (pagos.length === 0) {
        txt += ` - Nenhum pagamento registrado ainda\n`;
      } else {
        pagos.forEach(m => {
          txt += ` - ${m.nome} ✓\n`;
        });
      }

      txt += `\n⏳ *PENDENTES (${pend.length}):*\n`;
      if (pend.length === 0) {
        txt += ` - Todos os mensalistas pagaram! 🙌\n`;
      } else {
        pend.forEach(m => {
          txt += ` - ${m.nome}\n`;
        });
      }

      const pct = mensalistas.length ? Math.round((pagos.length / mensalistas.length) * 100) : 0;
      txt += `\n📊 *Progresso:* ${pagos.length} de ${mensalistas.length} pagos (${pct}%)`;
      if (state.chavePix) {
        txt += `\n💵 *Pix:* ${state.chavePix}`;
      }

      copyText(txt, 'Lista de mensalistas copiada! Só colar no WhatsApp. 😉');
    }

    function iniciarNovoMes() {
      const { mensalistas, avulsos, custoQuadra, saldoAnterior, avulsosPendentesAnt, valorMensalidade, valorAvulso, outrosDebitos, debitos, mesAno } = state;
      const pagos = mensalistas.filter(m => m.pago);
      const avP = avulsos.filter(a => a.status === 'pago');
      const avPend = avulsos.filter(a => a.status === 'pendente');
      const totalMens = pagos.length * valorMensalidade;
      const totalAvP = avP.length * valorAvulso;
      const totalDebitos = +outrosDebitos || 0;
      const totalRecebidoMes = avulsosPendentesAnt * valorAvulso + totalMens + totalAvP;
      const totalRec = saldoAnterior + totalRecebidoMes;
      const lucro = totalRec - custoQuadra - totalDebitos;

      const novoMesAno = proximoMesAno(mesAno || obterMesAnoAtual());
      const msg = `Você está iniciando um novo mês (${novoMesAno}).\n\n` +
        `Resumo atual:\n` +
        `- Caixa atual: ${brl(lucro)}\n` +
        `- Mensalistas pendentes: ${mensalistas.length - pagos.length}\n` +
        `- Avulsos pendentes que vão para o próximo mês: ${avPend.length}\n` +
        (totalDebitos > 0 ? `- Outros débitos do mês: ${brl(totalDebitos)}\n` : '') +
        `\nAs partidas e o ranking são preservados.\n\n` +
        `Deseja prosseguir? Isso limpará a lista de avulsos e débitos, resetará os pagamentos dos mensalistas e definirá o período como "${novoMesAno}".`;

      if (!confirm(msg)) return;

      const debitosDoMes = (debitos || []).slice();
      if (debitosDoMes.length) {
        if (!Array.isArray(state.debitosHistorico)) state.debitosHistorico = [];
        const entry = {
          mesAno: mesAno || obterMesAnoAtual(),
          itens: debitosDoMes.map(d => ({ id: d.id, descricao: d.descricao, valor: +d.valor || 0 })),
          total: debitosDoMes.reduce((s, d) => s + (+d.valor || 0), 0)
        };
        state.debitosHistorico.unshift(entry);
      }

      state.saldoAnterior = lucro;
      state.avulsosPendentesAnt = avPend.length;
      state.avulsos = [];
      state.debitos = [];
      state.outrosDebitos = 0;
      state.mensalistas = state.mensalistas.map(m => ({ ...m, pago: false }));
      state.mesAno = novoMesAno;

      save();
      render();
      alert(`Novo mês iniciado com sucesso! Saldo anterior definido para ${brl(lucro)} e período atualizado para ${novoMesAno}.`);
    }


function onHashChange() {
  if ((location.hash || '').startsWith('#a=')) {
    showAvaliarLoading();
    bootAvaliacaoFromHash().catch((e) => console.warn(e));
  } else if (document.documentElement.classList.contains('modo-avaliar') || document.body.classList.contains('modo-avaliar')) {
    exitModoAvaliarChrome();
    avaliarUi.payload = null; avaliarUi.avaliadorId = null; avaliarUi.notas = {}; avaliarUi.stats = {};
    render();
  }
}

function emptyStateForSkipAuth() {
  return {
    meta: { futId: null, configId: null, adminPlayerId: null, futNome: '' },
    mensalistas: [], avulsos: [], partidas: [],
    adminPerfil: { nome: '', nivel: 3, nivelAvaliacao: null, goleiro: false },
    jogadoresPorTime: 5, custoQuadra: 0, saldoAnterior: 0, avulsosPendentesAnt: 0,
    valorMensalidade: 0, valorAvulso: 0, mesAno: obterMesAnoAtual(), chavePix: '',
    debitos: [], outrosDebitos: 0, debitosHistorico: [], discordWebhookUrl: '',
    avaliacoes: [], balanceamentoTimes: 'nivel',
    peladaDiaSemana: 3, peladaHoraInicio: '21:00', peladaHoraFim: '23:00', peladaDataInicio: ''
  };
}

export async function bootApp(opts = {}) {
  if (!bootApp._hashWired) {
    bootApp._hashWired = true;
    window.addEventListener('hashchange', onHashChange);
  }

  // Link #a=: chrome já oculto; não hydrate/render da app principal enquanto busca a partida
  if (opts.skipAuth) {
    state = emptyStateForSkipAuth();
    showAvaliarLoading();
    await bootAvaliacaoFromHash();
    return;
  }

  try {
    state = await load();
  } catch (e) {
    throw e;
  }
  if (!state.mesAno) {
    state.mesAno = obterMesAnoAtual();
    try { await persist.saveConfig(state); } catch (e) { console.warn(e); }
  }
  if (!(await bootAvaliacaoFromHash())) render();
}

export function exposeGlobals() {
  Object.assign(window, {
    editMesAno, setTab, copiarResumoWhats, editSaldo, editAvulsosAnt, editCusto,
    addMensalista, copiarMensalistasWhats, addAvulso, setRankingFiltro, copiarRankingWhats,
    setBalanceamentoTimes, testarDiscordWebhook, resetarAvaliacoes,
    abrirHistoricoDebitos, addDebito, exportarBackup, importarBackup, iniciarNovoMes, trocarFut, criarNovoFut, apagarFutAtual, deslogar,
    onRankingPartidaChange, updateMesVigente, updateTaxas, updateJogadoresPorTime, updatePeladaConfig,
    updateAdminNome, updateDiscordWebhook, updatePix,
    adjStatAvaliar, setNotaAvaliar, setAvaliadorAvaliar, enviarAvaliacaoDiscord,
    cycleNivelAdmin, toggleGoleiroAdmin, cycleNivelMens,
    toggleGoleiroMens, toggleMens, removeMens, cycleNivelAv, toggleGoleiroAv, toggleAv,
    removeAv, removeDebito, moverJogadorParaTime, playerDragStart, playerDragEnd,
    teamDragOver, teamDragLeave, teamDrop, removeJogadorDaPartida,
    removeDraftConvidado, voltarListaPartidas, usarProximaPelada, usarProximaQuarta, addDraftConvidado,
    criarPartida, copiarPartidaWhats, copiarLinkAvaliacao,
    resetarAvaliacoesPartida, montarTimes, addJogadorNaPartida, removePartida,
    abrirNovaPartida, abrirDetalhePartida, fecharHistoricoDebitos, toggleDraftPlayer,
    setDraftDataFromInput, abrirRevisaoAvaliacoes, decidirAvaliacoes
  });
}

export { bootApp as startApp };
