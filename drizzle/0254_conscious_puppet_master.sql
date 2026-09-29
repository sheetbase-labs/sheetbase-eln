ALTER TABLE "api"."dataset_schema_definitions" ADD COLUMN "display_id" text;--> statement-breakpoint
ALTER TABLE "api"."notebook_templates" ADD COLUMN "display_id" text;--> statement-breakpoint
-- DSYS-05.4 — stable MDL-nnnn and TPL-nnnn display ids.
-- Extend the shared allocator so model and template families use the design
-- prefixes (MDL, TPL) rather than the first three letters of the kind.
CREATE OR REPLACE FUNCTION internal.next_display_id(p_workspace_id uuid, p_kind text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_prefix text;
  v_width integer;
  v_number bigint;
BEGIN
  v_prefix := CASE p_kind WHEN 'project' THEN 'PRJ' WHEN 'client' THEN 'CL'
                          WHEN 'model' THEN 'MDL' WHEN 'template' THEN 'TPL'
                          ELSE upper(left(p_kind, 3)) END;
  v_width := CASE p_kind WHEN 'client' THEN 3 ELSE 4 END;
  INSERT INTO internal.id_sequences (workspace_id, kind, last_number)
  VALUES (p_workspace_id, 'display:' || p_kind, 1)
  ON CONFLICT (workspace_id, kind)
  DO UPDATE SET last_number = internal.id_sequences.last_number + 1
  RETURNING last_number INTO v_number;
  RETURN v_prefix || '-' || lpad(v_number::text, v_width, '0');
END;
$$;
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_dataset_schema_definitions_workspace_display_id"
  ON api.dataset_schema_definitions (workspace_id, display_id)
  WHERE display_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_notebook_templates_workspace_display_id"
  ON api.notebook_templates (workspace_id, display_id)
  WHERE display_id IS NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.assign_model_display_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.display_id IS NULL THEN
    NEW.display_id := internal.next_display_id(NEW.workspace_id, 'model');
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER dataset_schema_definitions_assign_display_id
  BEFORE INSERT ON api.dataset_schema_definitions
  FOR EACH ROW EXECUTE FUNCTION internal.assign_model_display_id();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.assign_template_display_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.display_id IS NULL THEN
    NEW.display_id := internal.next_display_id(NEW.workspace_id, 'template');
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER notebook_templates_assign_display_id
  BEFORE INSERT ON api.notebook_templates
  FOR EACH ROW EXECUTE FUNCTION internal.assign_template_display_id();
--> statement-breakpoint
-- Backfill existing rows once (the assign triggers are INSERT-only).
UPDATE api.dataset_schema_definitions
  SET display_id = internal.next_display_id(workspace_id, 'model')
  WHERE display_id IS NULL;
--> statement-breakpoint
UPDATE api.notebook_templates
  SET display_id = internal.next_display_id(workspace_id, 'template')
  WHERE display_id IS NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.prevent_model_display_id_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF OLD.display_id IS NOT NULL
     AND NEW.display_id IS DISTINCT FROM OLD.display_id THEN
    RAISE EXCEPTION 'model display id is immutable' USING ERRCODE = 'SB072';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER prevent_model_display_id_change
  BEFORE UPDATE ON api.dataset_schema_definitions
  FOR EACH ROW EXECUTE FUNCTION internal.prevent_model_display_id_change();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.prevent_template_display_id_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF OLD.display_id IS NOT NULL
     AND NEW.display_id IS DISTINCT FROM OLD.display_id THEN
    RAISE EXCEPTION 'template display id is immutable' USING ERRCODE = 'SB072';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER prevent_template_display_id_change
  BEFORE UPDATE ON api.notebook_templates
  FOR EACH ROW EXECUTE FUNCTION internal.prevent_template_display_id_change();
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
