/** Literal JS para interpolar em atributo HTML delimitado por aspas duplas (ids são UUID). */
export function jsArg(value) {
  return JSON.stringify(String(value))
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
}

export function sameId(a, b) {
  return String(a) === String(b);
}

export function newId() {
  return crypto.randomUUID();
}

