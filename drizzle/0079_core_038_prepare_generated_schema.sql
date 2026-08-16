-- Drizzle's latest generated snapshot predates the custom 0074 constraints.
-- Drop and let the following generated migration recreate them while adding
-- the local-mutation ledger, bringing the generated snapshot back in sync.
ALTER TABLE api.sheet_instances
  DROP CONSTRAINT IF EXISTS chk_sheet_instances_name,
  DROP CONSTRAINT IF EXISTS chk_sheet_instances_description;
