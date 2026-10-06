import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
import path from "path";
const REPO = path.resolve(import.meta.dirname, "../../..");
export async function freshDb({ migrations = [] } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create role postgres_admin;
    create schema auth; create schema storage; create schema net; create schema extensions; create schema cron;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb, created_at timestamptz default now());
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'service_role') $$;
    create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text, owner uuid);
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table net._calls (id bigserial, url text, body jsonb);
    create function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb, timeout_milliseconds int default 5000) returns bigint language sql as $$ insert into net._calls(url, body) values (url, body) returning id $$;
  `);
  let sql = fs.readFileSync(`${REPO}/supabase/baseline/2026-09-30_production_schema.sql`, "utf8");
  sql = sql.replace(/^create extension.*$/gm, "");
  // cron section may reference cron functions; strip lines that call cron.schedule
  sql = sql.replace(/^select cron\.schedule[\s\S]*?;\s*$/gm, "");
  await db.exec(sql);
  for (const m of migrations) await db.exec(fs.readFileSync(m, "utf8"));
  return db;
}
if (process.argv[2] === "smoke") {
  const db = await freshDb();
  const r = await db.query("select count(*) from information_schema.tables where table_schema='public'");
  console.log("public tables:", r.rows[0]);
}

/** Ventes du mois vides (lots sans F17) : pour appeler l'export Compta dans les anciens tests. */
export function salesStub(finance) {
  const z = { gross: 0, cancelled: 0, cancelledCount: 0, kept: 0, gestures: 0, net: 0, cancellationRefunds: 0, cancellationsToRefund: 0, toCollect: 0,
    toCollectOrders: 0, orders: 0, cakes: 0, workshopSeats: 0, refusedCount: 0, toAcceptCount: 0, undatedCount: 0, undatedAmount: 0 };
  return { month: finance.month, from: finance.from, to: finance.to, includeTests: false, cards: z, lines: [], undated: [] };
}
