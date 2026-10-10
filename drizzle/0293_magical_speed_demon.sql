-- Snapshot reconciliation for 0292: the hand-written 0292 already drops this FK
-- and adds the workspace-aware source guard. IF EXISTS keeps this a no-op when
-- 0292 ran first, and this migration's snapshot keeps `db:generate` clean.
ALTER TABLE "api"."model_relationship_rules" DROP CONSTRAINT IF EXISTS "model_relationship_rules_source_model_key_model_kinds_key_fk";
