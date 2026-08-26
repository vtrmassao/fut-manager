-- Fut Manager v2 — schema inicial (financeiro + esportivo)
-- Projeto: fut-manager | Documentação versionada no repo; aplicar via MCP apply_migration

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    false
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated, anon;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Config (singleton)
-- ---------------------------------------------------------------------------

create table public.config (
  id uuid primary key default gen_random_uuid(),
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
  updated_at timestamptz not null default now()
);

create trigger config_set_updated_at
  before update on public.config
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Jogadores (admin + mensalistas + avulsos)
-- ---------------------------------------------------------------------------

create table public.jogadores (
  id uuid primary key default gen_random_uuid(),
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

create unique index jogadores_one_admin on public.jogadores (tipo) where tipo = 'admin';
create index jogadores_tipo_idx on public.jogadores (tipo);

-- ---------------------------------------------------------------------------
-- Débitos do mês + histórico
-- ---------------------------------------------------------------------------

create table public.debitos (
  id uuid primary key default gen_random_uuid(),
  descricao text not null,
  valor numeric(12,2) not null check (valor >= 0),
  created_at timestamptz not null default now()
);

create table public.debitos_historico (
  id uuid primary key default gen_random_uuid(),
  mes_ano text not null,
  total numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

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
  data date not null,
  hora_inicio text not null default '21:00',
  hora_fim text not null default '23:00',
  created_at timestamptz not null default now()
);

create index partidas_data_idx on public.partidas (data desc);

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
  partida_id uuid not null references public.partidas (id) on delete cascade,
  data date,
  avaliador_id uuid not null,
  importado_em timestamptz not null default now(),
  unique (partida_id, avaliador_id)
);

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
-- Seed: config singleton + jogador admin (nome vazio)
-- mes_ano em pt-BR é definido pelo app no primeiro hydrate
-- ---------------------------------------------------------------------------

insert into public.config (id, mes_ano, valor_mensalidade, valor_avulso, jogadores_por_time, balanceamento_times)
values (
  '00000000-0000-4000-8000-000000000001',
  '',
  50,
  15,
  5,
  'nivel'
);

insert into public.jogadores (id, tipo, nome, pago, status, nivel, nivel_avaliacao, goleiro)
values (
  '00000000-0000-4000-8000-0000000000a1',
  'admin',
  '',
  false,
  null,
  3,
  null,
  false
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

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

create policy config_admin_all on public.config
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy jogadores_admin_all on public.jogadores
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy debitos_admin_all on public.debitos
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy debitos_historico_admin_all on public.debitos_historico
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy debitos_historico_itens_admin_all on public.debitos_historico_itens
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy partidas_admin_all on public.partidas
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy partida_participantes_admin_all on public.partida_participantes
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy partida_times_admin_all on public.partida_times
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy avaliacoes_admin_all on public.avaliacoes
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy avaliacao_notas_admin_all on public.avaliacao_notas
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy avaliacao_stats_admin_all on public.avaliacao_stats
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Anon: sem policies = sem acesso direto (avaliações só via Edge Function service role)
