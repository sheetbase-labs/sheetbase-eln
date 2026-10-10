ALTER TABLE "api"."instruments" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "api"."instruments" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "api"."instruments" ADD COLUMN "retired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "api"."instruments" ADD CONSTRAINT "instruments_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- LAB-06 — instrument registry. create_instrument gains location and owner;
-- a writer can retire an instrument (kept for history, not bookable).
DROP FUNCTION IF EXISTS api.create_instrument(uuid,text,text,text,text,text,jsonb,integer);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.create_instrument(p_workspace_id uuid,p_name text,p_instrument_type text DEFAULT 'qpcr',p_model text DEFAULT NULL,p_serial_number text DEFAULT NULL,p_vendor text DEFAULT NULL,p_location text DEFAULT NULL,p_owner_id text DEFAULT NULL,p_config jsonb DEFAULT '{}'::jsonb,p_position integer DEFAULT 0) RETURNS api.instruments LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v api.instruments; v_dup boolean;
BEGIN
 IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE='SB033'; END IF;
 IF NOT api.is_workspace_writer(p_workspace_id) OR NOT api.has_write_actor() THEN RAISE EXCEPTION 'instrument denied' USING ERRCODE='42501'; END IF;
 IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid instrument name' USING ERRCODE='SB034'; END IF;
 IF p_instrument_type NOT IN ('qpcr','sequencer','spectrophotometer','other') THEN RAISE EXCEPTION 'invalid instrument type' USING ERRCODE='SB035'; END IF;
 IF p_location IS NOT NULL AND length(btrim(p_location)) > 200 THEN RAISE EXCEPTION 'invalid location' USING ERRCODE='SB034'; END IF;
 IF p_serial_number IS NOT NULL AND btrim(p_serial_number) <> '' THEN
  SELECT EXISTS (SELECT 1 FROM api.instruments i WHERE i.workspace_id = p_workspace_id AND i.serial_number = btrim(p_serial_number)) INTO v_dup;
  IF v_dup THEN RAISE EXCEPTION 'serial already registered' USING ERRCODE='23505'; END IF;
 END IF;
 INSERT INTO api.instruments(workspace_id,name,instrument_type,model,serial_number,vendor,location,owner_id,config,position,created_by_user_id,updated_by_user_id)
 VALUES(p_workspace_id,btrim(p_name),p_instrument_type,p_model,NULLIF(btrim(COALESCE(p_serial_number,'')),''),p_vendor,p_location,p_owner_id,COALESCE(p_config,'{}'),p_position,api.current_user_id(),api.current_user_id())
 RETURNING * INTO v; RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.create_instrument(uuid,text,text,text,text,text,text,text,jsonb,integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.create_instrument(uuid,text,text,text,text,text,text,text,jsonb,integer) TO authenticated;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.set_instrument_retired(p_instrument_id uuid,p_retired boolean) RETURNS api.instruments LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v api.instruments;
BEGIN
 SELECT * INTO v FROM api.instruments WHERE id=p_instrument_id;
 IF v.id IS NULL OR api.current_workspace_id() IS DISTINCT FROM v.workspace_id OR NOT api.is_workspace_writer(v.workspace_id) OR NOT api.has_write_actor() THEN RAISE EXCEPTION 'instrument denied' USING ERRCODE='42501'; END IF;
 UPDATE api.instruments SET retired_at=CASE WHEN p_retired THEN now() ELSE NULL END,updated_at=now(),updated_by_user_id=api.current_user_id() WHERE id=p_instrument_id RETURNING * INTO v; RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.set_instrument_retired(uuid,boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.set_instrument_retired(uuid,boolean) TO authenticated;
