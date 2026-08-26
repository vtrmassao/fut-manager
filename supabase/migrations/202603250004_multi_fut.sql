-- Fut Manager v2 — multi-fut por login admin (owner_id = auth.uid())
-- Reseta schema singleton; dados legados são descartados.

-- ---------------------------------------------------------------------------
-- Drop policies + tables (ordem de dependência)
-- ---------------------------------------------------------------------------

drop policy if exists avaliacao_stats_admin_all on public.avaliacao_stats;
drop policy if exists avaliacao_notas_admin_all on public.avaliacao_notas;
drop policy if exists avaliacoes_admin_all on public.avaliacoes;
drop policy if exists partida_times_admin_all on public.partida_times;
drop policy if exists partida_participantes_admin_all on public.partida_participantes;
drop policy if exists partidas_admin_all on public.partidas;
drop policy if exists debitos_historico_itens_admin_all on public.debitos_historico_itens;
drop policy if exists debitos_historico_admin_all on public.debitos_historico;
drop policy if exists debitos_admin_all on public.debitos;
drop policy if exists jogadores_admin_all on public.jogadores;
drop policy if exists config_admin_all on public.config;

drop table if exists public.avaliacao_stats cascade;
drop table if exists public.avaliacao_notas cascade;
drop table if exists public.avaliacoes cascade;
drop table if exists public.partida_times cascade;
drop table if exists public.partida_participantes cascade;
drop table if exists public.partidas cascade;
drop table if exists public.debitos_historico_itens cascade;
drop table if exists public.debitos_historico cascade;
drop table if exists public.debitos cascade;
drop table if exists public.jogadores cascade;
drop table if exists public.config cascade;
drop table if exists public.futs cascade;

-- ---------------------------------------------------------------------------
-- Futs (tenant por admin Auth)
-- ---------------------------------------------------------------------------

create table public.futs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  nome text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, nome)
);

create trigger futs_set_updated_at
  before update on public.futs
  for each row execute function public.set_updated_at();

create index futs_owner_idx on public.futs (owner_id);

-- ---------------------------------------------------------------------------
-- Config (1 por fut)
-- ---------------------------------------------------------------------------

create table public.config (
  id uuid primary key default gen_random_uuid(),
  fut_id uuid not null references public.futs (id) on delete cascade,
  mes_ano text not null default '',
  custo_quadra numeric(12,2) not null default 0,
  saldo_anterior numeric(12,2) not null default 0,
  avulsos_pendentes_ant integer not null default 0,
  valor_mensalidade numeric(12,2) not null default 50,
  valor_avulso numeric(12,2) not null default 15,
  outros_debitos numeric(12,2) not null default 0,
  jogadores_por_time integer not null default 5,
  balanceamento_times text not null default 'nivel'
    check (balanceamento_times in ('nivel', 'avaliacao')),
  chave_pix text not null default '',
  discord_webhook_url text not null default '',
  updated_at timestamptz not null default now(),
  unique (fut_id)
);

create trigger config_set_updated_at
  before update on public.config
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Jogadores (admin + mensalistas + avulsos)
-- ---------------------------------------------------------------------------

create table public.jogadores (
  id uuid primary key default gen_random_uuid(),
  fut_id uuid not null references public.futs (id) on delete cascade,
  tipo text not null check (tipo in ('admin', 'mensalista', 'avulso')),
  nome text not null,
  pago boolean not null default false,
  status text check (status is null or status in ('pago', 'pendente')),
  nivel smallint check (nivel is null or (nivel between 1 and 5)),
  nivel_avaliacao smallint check (nivel_avaliacao is null or (nivel_avaliacao between 1 and 5)),
  goleiro boolean not null default false,
  created_at timestamptz not null default now(),
  constraint jogadores_avulso_status check (
    (tipo = 'avulso' and status is not null) or (tipo <> 'avulso' and status is null)
  )
);

create unique index jogadores_one_admin_per_fut on public.jogadores (fut_id) where tipo = 'admin';
create index jogadores_fut_tipo_idx on public.jogadores (fut_id, tipo);

-- ---------------------------------------------------------------------------
-- Débitos
-- ---------------------------------------------------------------------------

create table public.debitos (
  id uuid primary key default gen_random_uuid(),
  fut_id uuid not null references public.futs (id) on delete cascade,
  descricao text not null,
  valor numeric(12,2) not null check (valor >= 0),
  created_at timestamptz not null default now()
);

create index debitos_fut_idx on public.debitos (fut_id);

create table public.debitos_historico (
  id uuid primary key default gen_random_uuid(),
  fut_id uuid not null references public.futs (id) on delete cascade,
  mes_ano text not null,
  total numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

create index debitos_historico_fut_idx on public.debitos_historico (fut_id);

create table public.debitos_historico_itens (
  id uuid primary key default gen_random_uuid(),
  historico_id uuid not null references public.debitos_historico (id) on delete cascade,
  item_id uuid,
  descricao text not null,
  valor numeric(12,2) not null check (valor >= 0)
);

create index debitos_historico_itens_hist_idx on public.debitos_historico_itens (historico_id);

-- ---------------------------------------------------------------------------
-- Partidas
-- ---------------------------------------------------------------------------

create table public.partidas (
  id uuid primary key default gen_random_uuid(),
  fut_id uuid not null references public.futs (id) on delete cascade,
  data date not null,
  hora_inicio text not null default '21:00',
  hora_fim text not null default '23:00',
  created_at timestamptz not null default now()
);

create index partidas_fut_data_idx on public.partidas (fut_id, data desc);

create table public.partida_participantes (
  partida_id uuid not null references public.partidas (id) on delete cascade,
  player_id uuid not null,
  nome text not null,
  origem text not null check (origem in ('admin', 'mensalista', 'avulso', 'convidado')),
  nivel smallint check (nivel is null or (nivel between 1 and 5)),
  goleiro boolean not null default false,
  gols integer not null default 0 check (gols >= 0),
  assistencias integer not null default 0 check (assistencias >= 0),
  defesas integer not null default 0 check (defesas >= 0),
  primary key (partida_id, player_id)
);

create table public.partida_times (
  partida_id uuid not null references public.partidas (id) on delete cascade,
  indice integer not null check (indice >= 0),
  player_ids uuid[] not null default '{}',
  primary key (partida_id, indice)
);

-- ---------------------------------------------------------------------------
-- Avaliações
-- ---------------------------------------------------------------------------

create table public.avaliacoes (
  id uuid primary key default gen_random_uuid(),
  fut_id uuid not null references public.futs (id) on delete cascade,
  partida_id uuid not null references public.partidas (id) on delete cascade,
  data date,
  avaliador_id uuid not null,
  importado_em timestamptz not null default now(),
  unique (partida_id, avaliador_id)
);

create index avaliacoes_fut_idx on public.avaliacoes (fut_id);

create table public.avaliacao_notas (
  avaliacao_id uuid not null references public.avaliacoes (id) on delete cascade,
  avaliado_id uuid not null,
  nota smallint not null check (nota between 1 and 5),
  primary key (avaliacao_id, avaliado_id)
);

create table public.avaliacao_stats (
  avaliacao_id uuid not null references public.avaliacoes (id) on delete cascade,
  player_id uuid not null,
  gols integer not null default 0 check (gols >= 0),
  assistencias integer not null default 0 check (assistencias >= 0),
  defesas integer,
  primary key (avaliacao_id, player_id)
);

-- ---------------------------------------------------------------------------
-- RLS helpers
-- ---------------------------------------------------------------------------

create or replace function public.owns_fut(p_fut_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.futs f
    where f.id = p_fut_id and f.owner_id = auth.uid()
  );
$$;

revoke all on function public.owns_fut(uuid) from public;
grant execute on function public.owns_fut(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: criar fut + config + admin-jogador
-- ---------------------------------------------------------------------------

create or replace function public.create_fut(p_nome text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fut_id uuid;
  v_config_id uuid;
  v_admin_id uuid;
  v_nome text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  if not public.is_admin() then
    raise exception 'Usuário sem role admin';
  end if;

  v_nome := trim(p_nome);
  if v_nome = '' then
    raise exception 'Nome do fut é obrigatório';
  end if;

  v_fut_id := gen_random_uuid();
  v_config_id := gen_random_uuid();
  v_admin_id := gen_random_uuid();

  insert into public.futs (id, owner_id, nome)
  values (v_fut_id, auth.uid(), v_nome);

  insert into public.config (id, fut_id, valor_mensalidade, valor_avulso, jogadores_por_time, balanceamento_times)
  values (v_config_id, v_fut_id, 50, 15, 5, 'nivel');

  insert into public.jogadores (id, fut_id, tipo, nome, pago, status, nivel, nivel_avaliacao, goleiro)
  values (v_admin_id, v_fut_id, 'admin', '', false, null, 3, null, false);

  return json_build_object(
    'futId', v_fut_id,
    'configId', v_config_id,
    'adminPlayerId', v_admin_id,
    'nome', v_nome
  );
end;
$$;

revoke all on function public.create_fut(text) from public;
grant execute on function public.create_fut(text) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS policies
-- ---------------------------------------------------------------------------

alter table public.futs enable row level security;
alter table public.config enable row level security;
alter table public.jogadores enable row level security;
alter table public.debitos enable row level security;
alter table public.debitos_historico enable row level security;
alter table public.debitos_historico_itens enable row level security;
alter table public.partidas enable row level security;
alter table public.partida_participantes enable row level security;
alter table public.partida_times enable row level security;
alter table public.avaliacoes enable row level security;
alter table public.avaliacao_notas enable row level security;
alter table public.avaliacao_stats enable row level security;

create policy futs_owner_all on public.futs
  for all to authenticated
  using (public.is_admin() and owner_id = auth.uid())
  with check (public.is_admin() and owner_id = auth.uid());

create policy config_owner_all on public.config
  for all to authenticated
  using (public.is_admin() and public.owns_fut(fut_id))
  with check (public.is_admin() and public.owns_fut(fut_id));

create policy jogadores_owner_all on public.jogadores
  for all to authenticated
  using (public.is_admin() and public.owns_fut(fut_id))
  with check (public.is_admin() and public.owns_fut(fut_id));

create policy debitos_owner_all on public.debitos
  for all to authenticated
  using (public.is_admin() and public.owns_fut(fut_id))
  with check (public.is_admin() and public.owns_fut(fut_id));

create policy debitos_historico_owner_all on public.debitos_historico
  for all to authenticated
  using (public.is_admin() and public.owns_fut(fut_id))
  with check (public.is_admin() and public.owns_fut(fut_id));

create policy debitos_historico_itens_owner_all on public.debitos_historico_itens
  for all to authenticated
  using (
    public.is_admin() and exists (
      select 1 from public.debitos_historico h
      where h.id = historico_id and public.owns_fut(h.fut_id)
    )
  )
  with check (
    public.is_admin() and exists (
      select 1 from public.debitos_historico h
      where h.id = historico_id and public.owns_fut(h.fut_id)
    )
  );

create policy partidas_owner_all on public.partidas
  for all to authenticated
  using (public.is_admin() and public.owns_fut(fut_id))
  with check (public.is_admin() and public.owns_fut(fut_id));

create policy partida_participantes_owner_all on public.partida_participantes
  for all to authenticated
  using (
    public.is_admin() and exists (
      select 1 from public.partidas p
      where p.id = partida_id and public.owns_fut(p.fut_id)
    )
  )
  with check (
    public.is_admin() and exists (
      select 1 from public.partidas p
      where p.id = partida_id and public.owns_fut(p.fut_id)
    )
  );

create policy partida_times_owner_all on public.partida_times
  for all to authenticated
  using (
    public.is_admin() and exists (
      select 1 from public.partidas p
      where p.id = partida_id and public.owns_fut(p.fut_id)
    )
  )
  with check (
    public.is_admin() and exists (
      select 1 from public.partidas p
      where p.id = partida_id and public.owns_fut(p.fut_id)
    )
  );

create policy avaliacoes_owner_all on public.avaliacoes
  for all to authenticated
  using (public.is_admin() and public.owns_fut(fut_id))
  with check (public.is_admin() and public.owns_fut(fut_id));

create policy avaliacao_notas_owner_all on public.avaliacao_notas
  for all to authenticated
  using (
    public.is_admin() and exists (
      select 1 from public.avaliacoes a
      where a.id = avaliacao_id and public.owns_fut(a.fut_id)
    )
  )
  with check (
    public.is_admin() and exists (
      select 1 from public.avaliacoes a
      where a.id = avaliacao_id and public.owns_fut(a.fut_id)
    )
  );

create policy avaliacao_stats_owner_all on public.avaliacao_stats
  for all to authenticated
  using (
    public.is_admin() and exists (
      select 1 from public.avaliacoes a
      where a.id = avaliacao_id and public.owns_fut(a.fut_id)
    )
  )
  with check (
    public.is_admin() and exists (
      select 1 from public.avaliacoes a
      where a.id = avaliacao_id and public.owns_fut(a.fut_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Grants (PostgREST)
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on public.futs to authenticated;

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

revoke select, insert, update, delete on public.futs from anon;
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
