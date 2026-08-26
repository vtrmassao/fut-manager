-- Privilégios de tabela para os roles do PostgREST.
-- As tabelas foram criadas por um role cujos default privileges não alcançam
-- anon/authenticated, então o RLS nunca era avaliado: toda query voltava 42501.
-- O acesso continua restrito pelas policies com is_admin().
grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on
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
to authenticated;

-- anon não fala com as tabelas: o link público de avaliação passa pela
-- Edge Function submit-avaliacao, que usa service_role.
revoke select, insert, update, delete on
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
from anon;
