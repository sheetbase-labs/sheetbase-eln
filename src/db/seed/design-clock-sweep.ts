/**
 * The design's dates are written against one day (25 Sep 2026), but a demo is
 * looked at weeks later, when every calibration is "40 days overdue" and the
 * milestones are all late. This step runs last and moves the whole seeded
 * timeline forward by a whole number of weeks, so the demo reads as if the
 * design day was a few days ago and weekdays still line up.
 *
 * - Event stamps (created, updated, signed ...) from the seed's own design dates
 *   move forward; stamps the wall clock already put after the design day are
 *   real and stay.
 * - Planned dates (due, expires, starts ...) and date columns all move.
 * - A row cannot be created after it was last updated, so any gap is closed.
 * - Audit entries are hash-chained over their timestamp, so the log is
 *   re-chained afterwards and `verify_audit_chain` still passes.
 *
 * It runs once per database (a marker table records it): the earlier steps
 * re-pin some rows to the design dates on a rerun, and shifting twice would
 * push the rest into the future. Use `db:fresh` to reseed from the design day.
 * Triggers are disabled table by table inside one statement, so a failure
 * rolls everything back and leaves none of them off.
 */
import { sql } from 'drizzle-orm'

import type { SeedStep } from './run'

type Db = Parameters<SeedStep['run']>[0]

const WEEK_DAYS = 7

/** Columns that name a planned or future instant rather than an event stamp. */
const SCHEDULE_COLUMN =
  '(due|expir|until|scheduled|next|end|valid|retention|effective|start|review|remind|deadline|window|trial|snooze|purge|delete_after)'

/** Whole weeks between the design day and `now`, in days. */
export function designShiftDays(clock: Date, now: Date = new Date()): number {
  const days = Math.floor((now.getTime() - clock.getTime()) / 86_400_000)
  return Math.max(0, Math.floor(days / WEEK_DAYS) * WEEK_DAYS)
}

export async function seedDesignClockSweep(
  db: Db,
  clock: Date,
  now: Date = new Date(),
): Promise<void> {
  const shift = designShiftDays(clock, now)
  const at = clock.toISOString()
  await db.execute(
    sql`create table if not exists internal.demo_clock_shift (shifted_days integer not null)`,
  )
  const applied = await db.execute(
    sql`select shifted_days from internal.demo_clock_shift limit 1`,
  )
  if (shift === 0 || applied.rows.length > 0) return

  await db.execute(sql`
    DO $sweep$
    DECLARE
      r record;
      design_clock constant timestamptz := ${sql.raw(`'${at}'`)}::timestamptz;
      shift constant interval := ${sql.raw(`'${shift} days'`)}::interval;
      event_cutoff constant timestamptz := design_clock + interval '12 hours';
      sets text;
    BEGIN
      FOR r IN
        SELECT c.table_name AS tbl,
               array_agg(c.column_name ORDER BY c.column_name) AS cols,
               array_agg(c.data_type ORDER BY c.column_name) AS types
          FROM information_schema.columns c
          JOIN information_schema.tables t
            ON t.table_schema = c.table_schema AND t.table_name = c.table_name
           AND t.table_type = 'BASE TABLE'
         WHERE c.table_schema = 'api'
           AND c.data_type IN ('timestamp with time zone', 'date')
           AND c.table_name <> 'change_events'
         GROUP BY c.table_name
      LOOP
        SELECT string_agg(
                 CASE
                   WHEN c.col ~ ${sql.raw(`'${SCHEDULE_COLUMN}'`)} OR c.typ = 'date'
                     THEN format('%1$I = %1$I + %2$L::interval', c.col, shift)
                   ELSE format('%1$I = CASE WHEN %1$I <= %2$L::timestamptz THEN %1$I + %3$L::interval ELSE %1$I END', c.col, event_cutoff, shift)
                 END, ', ')
          INTO sets
          FROM unnest(r.cols, r.types) AS c(col, typ);
        EXECUTE format('ALTER TABLE api.%I DISABLE TRIGGER USER', r.tbl);
        EXECUTE format('UPDATE api.%I SET %s', r.tbl, sets);
        EXECUTE format('ALTER TABLE api.%I ENABLE TRIGGER USER', r.tbl);
      END LOOP;

      -- Dates held inside a record's property bags ("expiry", "holdStartedAt",
      -- "received" ...). Signed records stay as they were frozen.
      EXECUTE $fn$
        CREATE FUNCTION pg_temp.shift_json_dates(j jsonb, days integer) RETURNS jsonb
        LANGUAGE plpgsql AS $body$
        DECLARE k text; v jsonb; res jsonb; s text;
        BEGIN
          CASE jsonb_typeof(j)
            WHEN 'object' THEN
              res := '{}'::jsonb;
              FOR k, v IN SELECT * FROM jsonb_each(j) LOOP
                res := res || jsonb_build_object(k, pg_temp.shift_json_dates(v, days));
              END LOOP;
              RETURN res;
            WHEN 'array' THEN
              SELECT coalesce(jsonb_agg(pg_temp.shift_json_dates(e, days)), '[]'::jsonb)
                INTO res FROM jsonb_array_elements(j) AS e;
              RETURN res;
            WHEN 'string' THEN
              s := j #>> '{}';
              IF s ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}($|T)' THEN
                RETURN to_jsonb(to_char(substr(s, 1, 10)::date + days, 'YYYY-MM-DD') || substr(s, 11));
              END IF;
              RETURN j;
            ELSE RETURN j;
          END CASE;
        END $body$
      $fn$;
      ALTER TABLE api.records DISABLE TRIGGER USER;
      UPDATE api.records
         SET properties = pg_temp.shift_json_dates(properties, ${sql.raw(`${shift}`)}),
             custom_fields = pg_temp.shift_json_dates(custom_fields, ${sql.raw(`${shift}`)})
       WHERE locked_at IS NULL;
      ALTER TABLE api.records ENABLE TRIGGER USER;

      -- Created cannot follow updated.
      FOR r IN
        SELECT a.table_name AS tbl
          FROM information_schema.columns a
          JOIN information_schema.columns b
            ON b.table_schema = a.table_schema AND b.table_name = a.table_name
           AND b.column_name = 'updated_at'
          JOIN information_schema.tables t
            ON t.table_schema = a.table_schema AND t.table_name = a.table_name
           AND t.table_type = 'BASE TABLE'
         WHERE a.table_schema = 'api' AND a.column_name = 'created_at'
           AND a.table_name <> 'change_events'
      LOOP
        EXECUTE format('ALTER TABLE api.%I DISABLE TRIGGER USER', r.tbl);
        EXECUTE format('UPDATE api.%I SET created_at = updated_at WHERE created_at > updated_at', r.tbl);
        EXECUTE format('ALTER TABLE api.%I ENABLE TRIGGER USER', r.tbl);
      END LOOP;
    END
    $sweep$`)

  await shiftAuditLog(db, at, shift)
  await db.execute(
    sql`insert into internal.demo_clock_shift (shifted_days) values (${shift})`,
  )
}

/** Shifts the audit log's timestamps and rebuilds its hash chain in order. */
async function shiftAuditLog(db: Db, at: string, shift: number): Promise<void> {
  await db.execute(sql`
    DO $audit$
    DECLARE
      r record;
      v_previous text;
      v_workspace uuid;
      v_created timestamptz;
      v_hash text;
      design_clock constant timestamptz := ${sql.raw(`'${at}'`)}::timestamptz;
      shift constant interval := ${sql.raw(`'${shift} days'`)}::interval;
    BEGIN
      ALTER TABLE api.change_events DISABLE TRIGGER USER;
      FOR r IN SELECT * FROM api.change_events ORDER BY workspace_id, sequence LOOP
        IF v_workspace IS DISTINCT FROM r.workspace_id THEN
          v_workspace := r.workspace_id;
          v_previous := NULL;
        END IF;
        v_created := r.created_at;
        IF v_created <= design_clock + interval '12 hours' THEN
          v_created := v_created + shift;
        END IF;
        v_hash := internal.audit_entry_hash(
          v_previous, r.workspace_id, r.sequence, r.entity_type, r.entity_uuid,
          r.operation, r.record_id, r.project_id, r.client_id, r.payload, v_created);
        IF v_created IS DISTINCT FROM r.created_at
           OR r.previous_hash IS DISTINCT FROM v_previous
           OR r.entry_hash IS DISTINCT FROM v_hash THEN
          UPDATE api.change_events
             SET created_at = v_created, previous_hash = v_previous, entry_hash = v_hash
           WHERE id = r.id;
        END IF;
        v_previous := v_hash;
      END LOOP;
      ALTER TABLE api.change_events ENABLE TRIGGER USER;
    END
    $audit$`)
}
