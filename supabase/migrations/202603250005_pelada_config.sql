-- Configuração da pelada por fut (dia da semana, horários, data de início)

alter table public.config
  add column if not exists pelada_dia_semana smallint not null default 3
    check (pelada_dia_semana between 0 and 6),
  add column if not exists pelada_hora_inicio text not null default '21:00',
  add column if not exists pelada_hora_fim text not null default '23:00',
  add column if not exists pelada_data_inicio date;
