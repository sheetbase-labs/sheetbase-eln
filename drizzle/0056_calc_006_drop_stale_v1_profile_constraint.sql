-- CALC-006: Drop the stale unnamed v1 profile-fingerprint CHECK constraint
-- from migration 0019.
--
-- Migration 0019 created `internal.formula_result_cache` with an unnamed
-- `CHECK (profile_fingerprint='fnv1a32-0c96cef0')`. PostgreSQL auto-named
-- it (typically `formula_result_cache_profile_fingerprint_check`).
--
-- Migration 0055 tried to drop it with
--   `DROP CONSTRAINT IF EXISTS formula_result_profile_check`
-- but that name did not match the auto-generated name, so the DROP
-- silently succeeded without removing anything. 0055 then added a NEW
-- named constraint `formula_result_profile_check` requiring the v2
-- fingerprint `fnv1a32-dcfa915f`.
--
-- Result: BOTH constraints co-existed. The v1 constraint still rejected
-- `fnv1a32-dcfa915f`, causing `apply_trusted_calculation` to fail with
-- SQLSTATE 23514 whenever it tried to cache a formula result — which
-- the app surfaced as a 500 "Calculation failed at stage: finalize."
--
-- This migration dynamically finds and drops the stale v1 constraint by
-- inspecting `pg_constraint` for the old fingerprint value. It also
-- drops the redundant unnamed `CHECK (engine_version='3.3.0')` since
-- the new combined constraint already covers it.
DO $$
DECLARE
  stale_constraint text;
BEGIN
  -- Drop the stale v1 profile_fingerprint constraint.
  SELECT conname INTO stale_constraint
  FROM pg_constraint
  WHERE conrelid = 'internal.formula_result_cache'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%fnv1a32-0c96cef0%'
    AND conname <> 'formula_result_profile_check';
  IF stale_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE internal.formula_result_cache DROP CONSTRAINT %I', stale_constraint);
  END IF;

  -- Drop the redundant unnamed engine_version constraint (the new
  -- formula_result_profile_check already requires engine_version='3.3.0').
  SELECT conname INTO stale_constraint
  FROM pg_constraint
  WHERE conrelid = 'internal.formula_result_cache'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%engine_version=''3.3.0''%'
    AND conname <> 'formula_result_profile_check';
  IF stale_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE internal.formula_result_cache DROP CONSTRAINT %I', stale_constraint);
  END IF;
END $$;
--> statement-breakpoint
