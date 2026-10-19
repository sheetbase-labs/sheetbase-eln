-- Event triggers can bind the triggering Dataset Version to a named pipeline
-- input (inputName) and can be limited to versions made from one instrument's
-- import (instrumentId). The scheduler already honours inputName; neither
-- field was validated, so a malformed value only failed when the first event
-- arrived. api.validate_pipeline_event_spec is the one choke point both the
-- create and update RPCs pass through, so it now refuses:
--   * an instrumentId that is not a uuid string, and
--   * an inputName that is not a valid pipeline input identifier.
-- JSON null still means "no filter" / "default input".

CREATE OR REPLACE FUNCTION api.validate_pipeline_event_spec(p_spec jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_spec jsonb := p_spec;
  v_event text;
  v_dataset jsonb;
  v_instrument jsonb;
  v_input jsonb;
BEGIN
  v_event := api.normalize_pipeline_event_type(v_spec->>'eventType');
  v_spec := jsonb_set(v_spec, '{eventType}', to_jsonb(v_event));
  v_dataset := v_spec->'datasetId';
  IF v_dataset IS NOT NULL AND v_dataset <> 'null'::jsonb THEN
    IF jsonb_typeof(v_dataset) <> 'string' THEN
      RAISE EXCEPTION 'invalid event dataset filter' USING ERRCODE = 'SB034';
    END IF;
    BEGIN
      PERFORM (v_spec->>'datasetId')::uuid;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'invalid event dataset filter' USING ERRCODE = 'SB034';
    END;
  END IF;
  v_instrument := v_spec->'instrumentId';
  IF v_instrument IS NOT NULL AND v_instrument <> 'null'::jsonb THEN
    IF jsonb_typeof(v_instrument) <> 'string' THEN
      RAISE EXCEPTION 'invalid event instrument filter' USING ERRCODE = 'SB034';
    END IF;
    BEGIN
      PERFORM (v_spec->>'instrumentId')::uuid;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'invalid event instrument filter' USING ERRCODE = 'SB034';
    END;
  END IF;
  v_input := v_spec->'inputName';
  IF v_input IS NOT NULL AND v_input <> 'null'::jsonb THEN
    IF jsonb_typeof(v_input) <> 'string'
       OR (v_spec->>'inputName') !~ '^[a-z][a-z0-9_]{0,47}$' THEN
      RAISE EXCEPTION 'invalid event input binding' USING ERRCODE = 'SB034';
    END IF;
  END IF;
  RETURN v_spec;
END $$;
