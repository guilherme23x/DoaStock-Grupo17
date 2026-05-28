-- Extensions
create extension if not exists "uuid-ossp";

-- ─── Organizations ──────────────────────────────────────────
create table if not exists organizations (
  id                  uuid primary key default uuid_generate_v4(),
  nome                text not null,
  cnpj                text unique,
  endereco            text,
  contato             text,
  descricao_missao    text,
  horario_recebimento text default 'Segunda a Sábado, 8h–17h',
  created_at          timestamptz not null default now()
);

-- ─── Users ──────────────────────────────────────────────────
create table if not exists users (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid not null references organizations(id) on delete cascade,
  nome          text not null,
  email         text not null unique,
  password_hash text not null,
  role          text not null check (role in ('coordinator','volunteer','donor')) default 'volunteer',
  created_at    timestamptz not null default now()
);

create index if not exists idx_users_org_id on users(org_id);
create index if not exists idx_users_email  on users(email);

-- ─── Items ──────────────────────────────────────────────────
create table if not exists items (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references organizations(id) on delete cascade,
  nome            text not null,
  categoria       text not null check (categoria in ('alimentos','higiene','limpeza','vestuario','outros')),
  codigo_barras   text,
  unidade_medida  text not null default 'un',
  imagem_url      text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_items_org_id        on items(org_id);
create index if not exists idx_items_codigo_barras on items(codigo_barras);

-- ─── Batches ────────────────────────────────────────────────
create table if not exists batches (
  id             uuid primary key default uuid_generate_v4(),
  org_id         uuid not null references organizations(id) on delete cascade,
  item_id        uuid not null references items(id) on delete cascade,
  quantidade     integer not null check (quantidade >= 0),
  data_validade  date not null,
  data_entrada   timestamptz not null default now(),
  doador         text,
  status         text not null check (status in ('ativo','distribuido','expirado')) default 'ativo',
  updated_at     timestamptz not null default now()
);

create index if not exists idx_batches_org_id        on batches(org_id);
create index if not exists idx_batches_item_validade  on batches(item_id, data_validade, status);
create index if not exists idx_batches_expiry_status  on batches(org_id, data_validade, status);

-- ─── Movements ──────────────────────────────────────────────
create table if not exists movements (
  id               uuid primary key default uuid_generate_v4(),
  org_id           uuid not null references organizations(id) on delete cascade,
  batch_id         uuid references batches(id),
  item_id          uuid not null references items(id),
  tipo             text not null check (tipo in ('entrada','saida')),
  quantidade       integer not null check (quantidade > 0),
  responsavel_id   uuid references users(id),
  observacao       text,
  created_at       timestamptz not null default now()
);

create index if not exists idx_movements_org_id     on movements(org_id, created_at desc);
create index if not exists idx_movements_item_id    on movements(item_id);

-- ─── Need Alerts ────────────────────────────────────────────
create table if not exists need_alerts (
  id                 uuid primary key default uuid_generate_v4(),
  org_id             uuid not null references organizations(id) on delete cascade,
  item_id            uuid not null references items(id) on delete cascade,
  quantidade_minima  integer not null check (quantidade_minima > 0),
  mensagem           text,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now()
);

create index if not exists idx_need_alerts_org_active on need_alerts(org_id, is_active);

-- ─── Donation Reports ────────────────────────────────────────
create table if not exists donation_reports (
  id                uuid primary key default uuid_generate_v4(),
  org_id            uuid not null references organizations(id) on delete cascade,
  periodo_inicio    date not null,
  periodo_fim       date not null,
  total_itens       integer default 0,
  total_beneficiados integer default 0,
  gerado_em         timestamptz not null default now()
);

-- ─── Views ──────────────────────────────────────────────────

-- Inventory aggregated per item
create or replace view inventory_view as
  select
    i.id,
    i.org_id,
    i.nome,
    i.categoria,
    i.codigo_barras,
    i.unidade_medida,
    coalesce(sum(b.quantidade) filter (where b.status = 'ativo'), 0) as total_quantity,
    min(b.data_validade) filter (where b.status = 'ativo')           as nearest_expiry,
    count(b.id) filter (where b.status = 'ativo')                    as active_batches
  from items i
  left join batches b on b.item_id = i.id
  group by i.id, i.org_id, i.nome, i.categoria, i.codigo_barras, i.unidade_medida;

-- Batch details with item name
create or replace view batch_details_view as
  select
    b.*,
    i.nome  as item_nome,
    i.categoria,
    i.unidade_medida
  from batches b
  join items i on i.id = b.item_id;

-- Movement details with item and user names
create or replace view movement_details_view as
  select
    m.*,
    i.nome       as item_nome,
    i.categoria,
    u.nome       as responsavel_nome
  from movements m
  join items i  on i.id = m.item_id
  left join users u on u.id = m.responsavel_id;

-- Stock by category per org
create or replace view inventory_by_category as
  select
    i.org_id,
    i.categoria                                                          as category,
    i.unidade_medida                                                     as unit,
    coalesce(sum(b.quantidade) filter (where b.status = 'ativo'), 0)    as total_quantity
  from items i
  left join batches b on b.item_id = i.id
  group by i.org_id, i.categoria, i.unidade_medida;

-- Need alert details with current stock
create or replace view need_alert_details_view as
  select
    na.*,
    i.nome       as item_nome,
    i.categoria,
    coalesce(sum(b.quantidade) filter (where b.status = 'ativo'), 0) as current_qty
  from need_alerts na
  join items i on i.id = na.item_id
  left join batches b on b.item_id = i.id
  group by na.id, na.org_id, na.item_id, na.quantidade_minima,
           na.mensagem, na.is_active, na.created_at, i.nome, i.categoria;

-- Public needs view (active alerts below minimum)
create or replace view public_needs_view as
  select
    na.id,
    na.org_id,
    na.item_id,
    i.nome       as item_nome,
    i.categoria,
    na.quantidade_minima,
    na.mensagem,
    na.is_active,
    coalesce(sum(b.quantidade) filter (where b.status = 'ativo'), 0) as current_qty
  from need_alerts na
  join items i on i.id = na.item_id
  left join batches b on b.item_id = i.id
  where na.is_active = true
  group by na.id, na.org_id, na.item_id, i.nome, i.categoria,
           na.quantidade_minima, na.mensagem, na.is_active
  having coalesce(sum(b.quantidade) filter (where b.status = 'ativo'), 0) < na.quantidade_minima
  order by (coalesce(sum(b.quantidade) filter (where b.status = 'ativo'), 0)::float / na.quantidade_minima);

-- Report by category view
create or replace view report_by_category_view as
  select
    m.org_id,
    i.categoria   as category,
    date_trunc('month', m.created_at)::date as period_start,
    sum(m.quantidade)                       as total
  from movements m
  join items i on i.id = m.item_id
  where m.tipo = 'entrada'
  group by m.org_id, i.categoria, date_trunc('month', m.created_at);

-- ─── Trigger: update batches.updated_at ──────────────────────
create or replace function set_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_batches_updated_at on batches;
create trigger trg_batches_updated_at
  before update on batches
  for each row execute function set_updated_at();

-- ─── RLS Policies ────────────────────────────────────────────
-- Desabilite RLS nas tabelas pois o backend usa service key
-- (o controle de acesso é feito no FastAPI via JWT)
alter table organizations  disable row level security;
alter table users          disable row level security;
alter table items          disable row level security;
alter table batches        disable row level security;
alter table movements      disable row level security;
alter table need_alerts    disable row level security;
alter table donation_reports disable row level security;

-- ─── Seed: Organização e Coordenador de Exemplo ──────────────
-- Senha: doastock123 (bcrypt hash abaixo)
do $$
declare
  v_org_id  uuid := uuid_generate_v4();
  v_user_id uuid := uuid_generate_v4();
begin
  insert into organizations (id, nome, cnpj, endereco, horario_recebimento, descricao_missao)
  values (
    v_org_id,
    'Banco de Alimentos Esperança',
    '12.345.678/0001-99',
    'Rua das Acácias, 200 – Guarulhos, SP',
    'Segunda a Sábado, 8h–17h',
    'Combater o desperdício alimentar e levar dignidade às famílias em situação de vulnerabilidade.'
  )
  on conflict do nothing;

  insert into users (id, org_id, nome, email, password_hash, role)
  values (
    v_user_id,
    v_org_id,
    'Coordenador Demo',
    'coordenador@doastock.org',
    -- senha: doastock123
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMqJqhHUX/Tq8Gf9k1zUcBt6m.',
    'coordinator'
  )
  on conflict (email) do nothing;
end;
$$;
