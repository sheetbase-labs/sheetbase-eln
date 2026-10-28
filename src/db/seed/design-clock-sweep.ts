/**
 * The design runs on a frozen clock (25 Sep 2026), but most of the seed goes
 * through RPCs and column defaults that stamp the wall clock, so a deployed
 * demo reseeded on 26 Oct shows experiments "started" a month after they were
 * last updated, models "updated" in the future and an audit log from today.
 *
 * This step runs last. Every event-stamp column (created, updated, published,
 * signed ...) holding an instant after the design clock but not after the
 * moment the sweep runs was stamped by the seed itself, so it is moved back to
 * the design clock by the same distance it was behind the wall clock: order is
 * kept, nothing lies in the future, and a row the seed made a few seconds ago
 * lands a few seconds before the design's 25 Sep 09:40. Columns that name a
 * schedule (due, expires, starts ...) are never touched.
 *
 * Triggers are disabled table by table inside one statement, so a failure
 * rolls the whole sweep back and leaves none of them off. Audit entries are
 * hash-chained over their timestamp, so the log is re-chained afterwards.
 */
import { sql } from 'drizzle-orm'

import type { SeedStep } from './run'

type Db = Parameters<SeedStep['run']>[0]

/** Columns that hold a planned or future instant rather than an event stamp. */
const SCHEDULE_COLUMN =
  '(due|expir|until|scheduled|next|end|valid|retention|effective|start|review|remind|deadline|window|trial|snooze|purge|delete_after)'

export async function seedDesignClockSweep(db: Db, clock: Date): Promise<void> {
  const at = clock.toISOString()
  await db.execute(sql`
    DO $sweep$
    DECLARE
      r record;
      design_clock constant timestamptz := ${sql.raw(`'${at}'`)}::timestamptz;
      wall constant timestamptz := clock_timestamp();
    BEGIN
      FOR r IN
        SELECT c.table_name AS tbl, array_agg(c.column_name ORDER BY c.column_name) AS cols
          FROM information_schema.columns c
          JOIN information_schema.tables t
            ON t.table_schema = c.table_schema AND t.table_name = c.table_name
           AND t.table_type = 'BASE TABLE'
         WHERE c.table_schema = 'api'
           AND c.data_type = 'timestamp with time zone'
           AND c.table_name <> 'change_events'
           AND c.column_name !~ ${sql.raw(`'${SCHEDULE_COLUMN}'`)}
         GROUP BY c.table_name
      LOOP
        EXECUTE format('ALTER TABLE api.%I DISABLE TRIGGER USER', r.tbl);
        EXECUTE format(
          'UPDATE api.%I SET %s',
          r.tbl,
          (SELECT string_agg(format(
             '%1$I = CASE WHEN %1$I > %2$L::timestamptz AND %1$I <= %3$L::timestamptz + interval ''5 minutes'' THEN %2$L::timestamptz - (%3$L::timestamptz - %1$I) ELSE %1$I END',
             col, design_clock, wall), ', ')
             FROM unnest(r.cols) AS col)
          || ' WHERE ' ||
          (SELECT string_agg(format(
             '(%1$I > %2$L::timestamptz AND %1$I <= %3$L::timestamptz + interval ''5 minutes'')',
             col, design_clock, wall), ' OR ')
             FROM unnest(r.cols) AS col));
        EXECUTE format('ALTER TABLE api.%I ENABLE TRIGGER USER', r.tbl);
      END LOOP;
    END
    $sweep$`)

  // A row cannot be created after it was last touched; the sweep keeps each
  // column's own distance from the wall clock, so close any gap it left.
  await db.execute(sql`
    DO $gap$
    DECLARE r record;
    BEGIN
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
        EXECUTE format(
          'UPDATE api.%I SET created_at = updated_at WHERE created_at > updated_at',
          r.tbl);
        EXECUTE format('ALTER TABLE api.%I ENABLE TRIGGER USER', r.tbl);
      END LOOP;
    END
    $gap$`)

  await sweepAuditLog(db, at)
}

/**
 * Moves the audit log's own timestamps and rebuilds its hash chain in order,
 * so `verify_audit_chain` still passes after the dates change.
 */
async function sweepAuditLog(db: Db, at: string): Promise<void> {
  await db.execute(sql`
    DO $audit$
    DECLARE
      r record;
      v_previous text;
      v_workspace uuid;
      v_created timestamptz;
      v_hash text;
      design_clock constant timestamptz := ${sql.raw(`'${at}'`)}::timestamptz;
      wall constant timestamptz := clock_timestamp();
    BEGIN
      ALTER TABLE api.change_events DISABLE TRIGGER USER;
      FOR r IN SELECT * FROM api.change_events ORDER BY workspace_id, sequence LOOP
        IF v_workspace IS DISTINCT FROM r.workspace_id THEN
          v_workspace := r.workspace_id;
          v_previous := NULL;
        END IF;
        v_created := r.created_at;
        IF v_created > design_clock AND v_created <= wall + interval '5 minutes' THEN
          v_created := design_clock - (wall - v_created);
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
