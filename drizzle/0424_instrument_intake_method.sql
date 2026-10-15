-- R5-CONFIG-02 — an instrument declares how its data arrives.
--
-- The register dialog and the design's "How data gets in" choice need the intake method on the
-- instrument itself. It is instrument configuration, not an integration: there is no connector
-- registry behind it, and the four methods carry the provenance the product can honour.
--   filedrop  files the instrument (or its PC) writes to a watched folder arrive through a
--             validated parser and become dataset_imports with frozen parser + source provenance.
--   webhook   the instrument's software posts results; the import records its own frozen
--             provenance the same way.
--   manual    a person types readings in; the provenance is the entering user on the reading.
--   none      registered for booking and citing only; nothing arrives.
-- The method is configuration for what happens next. It is deliberately not part of the frozen
-- revision evidence (LAB-06.4) and not part of an import's parser/source provenance, so changing
-- it never rewrites history: imports already committed keep the provenance they arrived with,
-- and internal.instrument_change_event records only name, location and qualified-for.

ALTER TABLE "api"."instruments" ADD COLUMN "intake_method" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."instruments" ADD CONSTRAINT "chk_instruments_intake_method" CHECK ("intake_method" IN ('filedrop','webhook','manual','none'));--> statement-breakpoint
COMMENT ON COLUMN "api"."instruments"."intake_method" IS
  'R5-CONFIG-02 — how data arrives: filedrop, webhook, manual or none. Configuration for future data only.';--> statement-breakpoint

-- LAB-06 — instrument registry. create_instrument gains the intake method; a writer can change
-- it later (existing imports keep their own frozen provenance, so this is not a history write).
DROP FUNCTION IF EXISTS api.create_instrument(uuid,text,text,text,text,text,text,text,jsonb,integer);--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.create_instrument(p_workspace_id uuid,p_name text,p_instrument_type text DEFAULT 'qpcr',p_model text DEFAULT NULL,p_serial_number text DEFAULT NULL,p_vendor text DEFAULT NULL,p_location text DEFAULT NULL,p_owner_id text DEFAULT NULL,p_config jsonb DEFAULT '{}'::jsonb,p_position integer DEFAULT 0,p_intake_method text DEFAULT 'none') RETURNS api.instruments LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v api.instruments; v_dup boolean;
BEGIN
 IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE='SB033'; END IF;
 IF NOT api.is_workspace_writer(p_workspace_id) OR NOT api.has_write_actor() THEN RAISE EXCEPTION 'instrument denied' USING ERRCODE='42501'; END IF;
 IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid instrument name' USING ERRCODE='SB034'; END IF;
 IF p_instrument_type NOT IN ('qpcr','sequencer','spectrophotometer','other') THEN RAISE EXCEPTION 'invalid instrument type' USING ERRCODE='SB035'; END IF;
 IF p_intake_method NOT IN ('filedrop','webhook','manual','none') THEN RAISE EXCEPTION 'invalid intake method' USING ERRCODE='SB035'; END IF;
 IF p_location IS NOT NULL AND length(btrim(p_location)) > 200 THEN RAISE EXCEPTION 'invalid location' USING ERRCODE='SB034'; END IF;
 IF p_serial_number IS NOT NULL AND btrim(p_serial_number) <> '' THEN
  SELECT EXISTS (SELECT 1 FROM api.instruments i WHERE i.workspace_id = p_workspace_id AND i.serial_number = btrim(p_serial_number)) INTO v_dup;
  IF v_dup THEN RAISE EXCEPTION 'serial already registered' USING ERRCODE='23505'; END IF;
 END IF;
 INSERT INTO api.instruments(workspace_id,name,instrument_type,model,serial_number,vendor,location,owner_id,intake_method,config,position,created_by_user_id,updated_by_user_id)
 VALUES(p_workspace_id,btrim(p_name),p_instrument_type,p_model,NULLIF(btrim(COALESCE(p_serial_number,'')),''),p_vendor,p_location,p_owner_id,p_intake_method,COALESCE(p_config,'{}'),p_position,api.current_user_id(),api.current_user_id())
 RETURNING * INTO v; RETURN v;
END $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.create_instrument(uuid,text,text,text,text,text,text,text,jsonb,integer,text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.create_instrument(uuid,text,text,text,text,text,text,text,jsonb,integer,text) TO authenticated;--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.set_instrument_intake_method(p_instrument_id uuid,p_intake_method text) RETURNS api.instruments LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v api.instruments;
BEGIN
 IF p_intake_method NOT IN ('filedrop','webhook','manual','none') THEN RAISE EXCEPTION 'invalid intake method' USING ERRCODE='SB035'; END IF;
 SELECT * INTO v FROM api.instruments WHERE id=p_instrument_id;
 IF v.id IS NULL OR api.current_workspace_id() IS DISTINCT FROM v.workspace_id OR NOT api.is_workspace_writer(v.workspace_id) OR NOT api.has_write_actor() THEN RAISE EXCEPTION 'instrument denied' USING ERRCODE='42501'; END IF;
 UPDATE api.instruments SET intake_method=p_intake_method,updated_at=now(),updated_by_user_id=api.current_user_id() WHERE id=p_instrument_id RETURNING * INTO v; RETURN v;
END $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.set_instrument_intake_method(uuid,text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.set_instrument_intake_method(uuid,text) TO authenticated;--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
