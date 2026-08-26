/** Utilitários de nível — reexportados para organização modular. */
export function isNivelDesconhecido(n) {
  return n === null || n === '?';
}

export function normalizeNivel(n) {
  if (isNivelDesconhecido(n)) return null;
  if (n === undefined || n === '') return 3;
  const v = Number(n);
  if (!v || isNaN(v)) return null;
  return Math.min(5, Math.max(1, Math.round(v)));
}

export function nivelParaSorteio(n) {
  const v = normalizeNivel(n);
  return v === null ? 3 : v;
}

export function formatNivel(n) {
  if (isNivelDesconhecido(n)) return '?';
  const v = normalizeNivel(n);
  return v === null ? '?' : String(v);
}

export function cycleNivelValue(n) {
  if (isNivelDesconhecido(n)) return 1;
  const v = normalizeNivel(n);
  if (v === null || v >= 5) return null;
  return v + 1;
}
