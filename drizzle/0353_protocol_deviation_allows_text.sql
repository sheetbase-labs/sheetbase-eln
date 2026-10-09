-- LAB-07 — a copied execution step may deviate from the pinned protocol.
--
-- SCI-002 made an execution step's scientific text immutable and refused any
-- difference from the pinned revision. LAB-07 requires the opposite: editing
-- linked protocol text inside a notebook records a deviation (see
-- `internal.protocol_step_deviation`). The text may now change; step numbering
-- and provenance remain immutable, and the protocol Record's own definition
-- still cannot carry execution state.
DO $$ DECLARE definition text; before text; after text;
BEGIN
  definition := pg_get_functiondef('api.validate_scientific_block()'::regprocedure);

  before := E'      IF NEW.payload->''text'' IS DISTINCT FROM (\n          SELECT x->''payload''->''text'' FROM jsonb_array_elements(rev.block_snapshot) x\n          WHERE x->>''id''=NEW.payload->>''sourceStepBlockId'' AND x->>''type''=''procedure_step''\n        ) OR NEW.payload->''stepNumber'' IS DISTINCT FROM (';
  if strpos(definition, before) = 0 THEN
    RAISE EXCEPTION 'execution step text anchor missing';
  END IF;
  after := E'      IF NEW.payload->''stepNumber'' IS DISTINCT FROM (';
  definition := replace(definition, before, after);

  before := E'      IF TG_OP=''UPDATE'' AND (NEW.payload->''text'' IS DISTINCT FROM OLD.payload->''text''\n        OR NEW.payload->''stepNumber'' IS DISTINCT FROM OLD.payload->''stepNumber''';
  if strpos(definition, before) = 0 THEN
    RAISE EXCEPTION 'execution step immutability anchor missing';
  END IF;
  after := E'      IF TG_OP=''UPDATE'' AND (NEW.payload->''stepNumber'' IS DISTINCT FROM OLD.payload->''stepNumber''';
  definition := replace(definition, before, after);

  EXECUTE definition;
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
