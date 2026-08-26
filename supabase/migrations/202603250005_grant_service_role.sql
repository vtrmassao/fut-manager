-- Edge Functions com service_role bypassam RLS mas precisam de GRANT de tabela.
-- A migration multi-fut recriou as tabelas com grant só para authenticated.
grant select, insert, update, delete on
  public.futs,
  public.config,
  public.jogadores,
  public.debitos,
  public.debitos_historico,
  public.debitos_historico_itens,
  public.partidas,
  public.partida_participantes,
  public.partida_times,
  public.avaliacoes,
  public.avaliacao_notas,
  public.avaliacao_stats
to service_role;
