export function showSaveBadge(status) {
  const badge = document.getElementById('save-badge');
  if (!badge) return;
  badge.style.display = '';
  badge.className = `save-badge ${
    status === 'error' ? 'save-error' :
    status === 'saving' ? 'save-saving' : 'save-saved'
  }`;
  badge.textContent =
    status === 'error' ? '⚠ ERRO' :
    status === 'saving' ? '… SALVANDO' : '✓ SALVO';
  clearTimeout(showSaveBadge.timeout);
  if (status === 'saved') {
    showSaveBadge.timeout = setTimeout(() => {
      badge.style.display = 'none';
    }, 1800);
  }
}

