-- Aprovação manual de avaliações: Av e G/A/D só após admin aprovar.
alter table public.avaliacoes
  add column if not exists aprovada_em timestamptz,
  add column if not exists rejeitada_em timestamptz;

-- Avaliações já existentes: considerar aprovadas
update public.avaliacoes
set aprovada_em = coalesce(importado_em, now())
where aprovada_em is null
  and rejeitada_em is null;
