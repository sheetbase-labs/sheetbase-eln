-- LAB-04.1 — the model registry follows the kind rename.
--
-- api.model_kinds was renamed with the kind, but the two registries that hang off it were
-- not: api.model_base_fields declares a kind's legacy properties (104 rows) and api.model_rules
-- its rules. guard_record_properties validates every written property against
-- model_base_fields for the record's kind, so leaving these behind made every seeded material
-- record fail with "unknown legacy property lot" — the kind existed but had no declared fields.
--
-- This is the same rename applied to the rest of the registry. It is a data change only: the
-- columns already hold the kind as text.

-- api.model_kinds carries the kind twice: `key`, which the registry's foreign keys target,
-- and `record_kind`, which the record guard reads. The earlier migration renamed only the
-- second, so the registry's keys still pointed at a kind nothing else named.
--
-- Renaming the key and its dependants is circular - each side's foreign key blocks the
-- other's update - so the constraint is dropped, both sides move together, and it is
-- restored immediately.
ALTER TABLE api.model_base_fields DROP CONSTRAINT model_base_fields_model_key_fkey;
--> statement-breakpoint
UPDATE api.model_kinds SET key = 'material' WHERE key = 'reagent';
--> statement-breakpoint
UPDATE api.model_base_fields SET model_key = 'material' WHERE model_key = 'reagent';
--> statement-breakpoint
ALTER TABLE api.model_base_fields
  ADD CONSTRAINT model_base_fields_model_key_fkey
  FOREIGN KEY (model_key) REFERENCES api.model_kinds(key) ON DELETE CASCADE;
--> statement-breakpoint
--> statement-breakpoint
UPDATE api.model_rules SET model_key = 'material' WHERE model_key = 'reagent';
--> statement-breakpoint

-- Nothing in the registry should still name the old kind.
DO $$
DECLARE
  remaining text;
BEGIN
  SELECT string_agg(where_it, ', ') INTO remaining FROM (
    SELECT 'model_base_fields' AS where_it FROM api.model_base_fields WHERE model_key = 'reagent'
    UNION ALL
    SELECT 'model_rules' FROM api.model_rules WHERE model_key = 'reagent'
    UNION ALL
    SELECT 'model_kinds' FROM api.model_kinds WHERE record_kind = 'reagent'
  ) leftovers;
  IF remaining IS NOT NULL THEN
    RAISE EXCEPTION 'the model registry still names the old kind in: %', remaining;
  END IF;
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
