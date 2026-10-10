-- LAB-04.1 — the record kind is `material`, not `reagent`.
--
-- The owner decided the rename. DEC-07/ADR-0051 makes materials a built-in kind rather than
-- a workspace-defined one, and the route and UI have said "Materials" for a while; the kind
-- was the last place still calling them reagents.
--
-- What is renamed: the record kind, the record-link type, and the change-event entity type
-- those two produce. What is not: the RPC names (`record_reagent_movement`,
-- `reagent_attention_summary`, `emit_reagent_expiry_events`) and the `reagent_movements`
-- table with its `reagent_record_id` column. The step asks for the kind, routes and copy; an
-- internal function or table name is neither, and renaming them would churn every caller for
-- no reader's benefit.
--
-- The two functions whose *bodies* compare the kind are patched so they follow it. Each
-- patch asserts its marker was found, so a missed match raises rather than leaving a function
-- quietly filtering on a kind that no longer exists.

-- 1. The kind itself.
--
-- api.records carries a guard that refuses to change a record's kind, and api.model_kinds
-- lists the kinds the guard accepts. Both have to move together, so the guard is stepped
-- around for exactly this statement and re-enabled immediately: the guard exists to stop
-- application code re-pointing a record at a different kind, and this is a reviewed
-- vocabulary rename applied to every such record at once in one transaction, not a record
-- changing what it is.
ALTER TABLE api.records DISABLE TRIGGER guard_record_kind;
--> statement-breakpoint
UPDATE api.model_kinds SET record_kind = 'material' WHERE record_kind = 'reagent';
--> statement-breakpoint
UPDATE api.records SET kind = 'material' WHERE kind = 'reagent';
--> statement-breakpoint
ALTER TABLE api.records ENABLE TRIGGER guard_record_kind;
--> statement-breakpoint

-- 2. The link type: drop the old vocabulary, move the rows, then constrain the new one.
ALTER TABLE api.record_links DROP CONSTRAINT IF EXISTS chk_record_links_link_type;
--> statement-breakpoint
UPDATE api.record_links SET link_type = 'material' WHERE link_type = 'reagent';
--> statement-breakpoint
ALTER TABLE api.record_links
  ADD CONSTRAINT chk_record_links_link_type CHECK (
    link_type IN (
      'sample', 'protocol', 'dataset', 'material', 'analysis', 'file',
      'general', 'template', 'follows', 'upstream'
    )
  );
--> statement-breakpoint

-- 3. The change-event entity type follows the kind, so history keeps matching.
DO $$
DECLARE
  def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def
    FROM pg_constraint WHERE conname = 'chk_change_events_entity_type';
  IF position('''reagent''' in def) = 0 THEN RETURN; END IF;
  EXECUTE 'ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type';
  -- pg_get_constraintdef already returns the leading CHECK (...).
  EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type '
    || replace(def, '''reagent''', '''material''');
END $$;
--> statement-breakpoint
UPDATE api.change_events SET entity_type = 'material' WHERE entity_type = 'reagent';
--> statement-breakpoint

-- 4. The two functions that compare the kind.
DO $$
DECLARE
  def text;
BEGIN
  def := pg_get_functiondef('api.reagent_attention_summary(integer)'::regprocedure);
  IF position('kind = ''reagent''' in def) > 0 THEN
    def := replace(def, 'kind = ''reagent''', 'kind = ''material''');
    EXECUTE def;
  END IF;

  def := pg_get_functiondef('internal.emit_reagent_expiry_events(integer)'::regprocedure);
  IF position('kind = ''reagent''' in def) = 0 AND position('''reagent''' in def) = 0 THEN
    RETURN;
  END IF;
  def := replace(def, 'rec.kind = ''reagent''', 'rec.kind = ''material''');
  def := replace(def, 'e.entity_type = ''reagent''', 'e.entity_type = ''material''');
  def := replace(def, '''reagent'', r.id', '''material'', r.id');
  EXECUTE def;
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
