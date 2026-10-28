-- Fields added to built-in models (Experiment, Sample, Material, Protocol,
-- Project, Instrument) had nowhere to say where they belong on screen. Each
-- definition now carries its placement: the heading it sits under on the
-- record page, whether the create form asks for it, and whether lists offer
-- it as a column. Placement is presentation, not the value contract, so it
-- stays editable after the field is in use; type, key and required-ness keep
-- their existing immutability once a field is active.

ALTER TABLE api.record_field_definitions
  ADD COLUMN section text,
  ADD COLUMN show_in_list boolean DEFAULT false NOT NULL,
  ADD COLUMN ask_on_create boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE api.record_field_definitions
  ADD CONSTRAINT chk_record_field_definitions_section
  CHECK (section IS NULL OR length(btrim(section)) BETWEEN 1 AND 80);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.update_model_field(p_definition_id uuid, p_patch jsonb) RETURNS api.record_field_definitions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$ DECLARE v api.record_field_definitions; BEGIN
 SELECT * INTO v FROM api.record_field_definitions WHERE id=p_definition_id; IF NOT api.is_model_field_admin(v.workspace_id) THEN RAISE EXCEPTION 'owner/admin required' USING ERRCODE='42501'; END IF;
 IF p_patch - ARRAY['label','description','displayOrder','nullable','defaultValue','validation','section','showInList','askOnCreate'] <> '{}'::jsonb THEN RAISE EXCEPTION 'unknown model field patch property' USING ERRCODE='SB071'; END IF;
 IF v.lifecycle IN ('active','retired') AND p_patch ?| ARRAY['nullable','defaultValue','validation'] THEN RAISE EXCEPTION 'active field contract is immutable' USING ERRCODE='SB072'; END IF;
 IF p_patch ? 'label' AND length(btrim(p_patch->>'label')) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid field label' USING ERRCODE='SB071'; END IF;
 UPDATE api.record_field_definitions SET
   label=coalesce(btrim(p_patch->>'label'),label),
   description=CASE WHEN p_patch?'description' THEN nullif(btrim(p_patch->>'description'),'') ELSE description END,
   display_order=coalesce((p_patch->>'displayOrder')::integer,display_order),
   nullable=coalesce((p_patch->>'nullable')::boolean,nullable),
   default_value=CASE WHEN p_patch?'defaultValue' THEN p_patch->'defaultValue' ELSE default_value END,
   validation=coalesce(p_patch->'validation',validation),
   section=CASE WHEN p_patch?'section' THEN nullif(btrim(p_patch->>'section'),'') ELSE section END,
   show_in_list=coalesce((p_patch->>'showInList')::boolean,show_in_list),
   ask_on_create=coalesce((p_patch->>'askOnCreate')::boolean,ask_on_create),
   updated_at=now()
 WHERE id=p_definition_id RETURNING * INTO v; RETURN v; END $$;
--> statement-breakpoint
-- Lot quantity, receipt and release are recorded by the lot page's own steps,
-- so registering a lot does not ask for them.
UPDATE api.record_field_definitions SET ask_on_create = false
  WHERE kind = 'material' AND field_name IN
    ('initial_quantity', 'received', 'released_by', 'released_at', 'certificate');
