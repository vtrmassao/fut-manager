export function brl(v) {
  return 'R$ ' + Number(v).toFixed(2).replace('.', ',');
}
