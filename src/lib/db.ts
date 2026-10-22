import postgres from "postgres";

const g = globalThis as unknown as { sql?: postgres.Sql; schemaReady?: Promise<void> };

export const sql =
  g.sql ??
  postgres(process.env.DATABASE_URL ?? "postgres://postgres:dev@localhost:5433/sales", {
    max: 5,
    prepare: false, // compatible with pooled connections (Neon / PgBouncer)
    onnotice: () => {},
  });
if (process.env.NODE_ENV !== "production") g.sql = sql;

const SCHEMA = `
-- Single editable policy; every change bumps the version so leads record which one applied.
create table if not exists policy (
  id int primary key default 1 check (id = 1),
  version int not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- One contact per (channel, sender id). People are never merged across channels automatically.
create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('whatsapp', 'instagram', 'email')),
  external_id text not null,
  display_name text,
  handle text,
  created_at timestamptz not null default now(),
  unique (channel, external_id)
);

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null unique references contacts(id) on delete cascade,
  status text not null default 'needs_info',
  stage text not null default 'collecting',
  fields jsonb not null default '{}'::jsonb,
  qualification jsonb,
  assignment jsonb,
  offered_slots jsonb not null default '[]'::jsonb,
  pending_slot jsonb,
  policy_version int,
  takeover boolean not null default false,
  thread jsonb not null default '{}'::jsonb,
  lease_until timestamptz,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  channel text not null,
  direction text not null check (direction in ('in', 'out')),
  author text not null check (author in ('customer', 'assistant', 'human')),
  external_id text,
  text text not null,
  status text not null,
  error text,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
-- A webhook delivered twice (or an email fetched twice) is stored once.
create unique index if not exists messages_external_idx on messages(channel, external_id) where external_id is not null;
create index if not exists messages_lead_idx on messages(lead_id, created_at);

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  rep_id text not null,
  slot_start timestamptz not null,
  slot_end timestamptz not null,
  event_id text not null unique,
  status text not null check (status in ('pending', 'confirmed', 'uncertain', 'failed')),
  html_link text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- At most one live booking per lead, and never two live bookings for the same rep and time.
create unique index if not exists bookings_one_per_lead on bookings(lead_id) where status in ('pending', 'confirmed', 'uncertain');
create unique index if not exists bookings_one_per_slot on bookings(rep_id, slot_start) where status in ('pending', 'confirmed', 'uncertain');

create table if not exists events (
  id bigserial primary key,
  lead_id uuid references leads(id) on delete cascade,
  level text not null check (level in ('info', 'warn', 'error')),
  kind text not null,
  text text not null,
  data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists events_lead_idx on events(lead_id, id);

-- Health of each integration, shown in the dashboard; also stores the email poll cursor.
create table if not exists integrations (
  name text primary key,
  status text not null,
  detail text,
  cursor jsonb,
  last_ok_at timestamptz,
  last_error_at timestamptz,
  updated_at timestamptz not null default now()
);
`;

export function ensureSchema(): Promise<void> {
  g.schemaReady ??= sql.unsafe(SCHEMA).then(() => undefined);
  return g.schemaReady;
}

export const json = (v: unknown) => sql.json(v as postgres.JSONValue);

export type Sql = postgres.Sql | postgres.TransactionSql;

export async function logEvent(
  db: Sql,
  leadId: string | null,
  level: "info" | "warn" | "error",
  kind: string,
  text: string,
  data?: unknown,
) {
  await db`insert into events (lead_id, level, kind, text, data) values (${leadId}, ${level}, ${kind}, ${text}, ${data === undefined ? null : json(data)})`;
}

export type IntegrationName = "whatsapp" | "instagram" | "email" | "calendar" | "llm";

/** Records the latest outcome of talking to an external service, so failures are visible, not silent. */
export async function setIntegration(name: IntegrationName, status: "ok" | "error" | "auth_error", detail?: string) {
  await ensureSchema();
  await sql`
    insert into integrations (name, status, detail, last_ok_at, last_error_at)
    values (${name}, ${status}, ${detail ?? null}, ${status === "ok" ? sql`now()` : null}, ${status === "ok" ? null : sql`now()`})
    on conflict (name) do update set
      status = excluded.status,
      detail = excluded.detail,
      last_ok_at = coalesce(excluded.last_ok_at, integrations.last_ok_at),
      last_error_at = coalesce(excluded.last_error_at, integrations.last_error_at),
      updated_at = now()`;
}
