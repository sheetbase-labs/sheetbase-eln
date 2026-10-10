ALTER TABLE "api"."analysis_views" ADD COLUMN "display_id" text;--> statement-breakpoint
ALTER TABLE "api"."sheet_instances" ADD COLUMN "display_id" text;--> statement-breakpoint
-- DSYS-05.4 — stable SHT-nnnn and AN-nnnn display ids.
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
                          WHEN 'sheet' THEN 'SHT' WHEN 'analysis' THEN 'AN'
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
CREATE UNIQUE INDEX "uq_sheet_instances_workspace_display_id"
  ON api.sheet_instances (workspace_id, display_id)
  WHERE display_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_analysis_views_workspace_display_id"
  ON api.analysis_views (workspace_id, display_id)
  WHERE display_id IS NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.assign_sheet_display_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.display_id IS NULL THEN
    NEW.display_id := internal.next_display_id(NEW.workspace_id, 'sheet');
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sheet_instances_assign_display_id
  BEFORE INSERT ON api.sheet_instances
  FOR EACH ROW EXECUTE FUNCTION internal.assign_sheet_display_id();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.assign_analysis_display_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.display_id IS NULL THEN
    NEW.display_id := internal.next_display_id(NEW.workspace_id, 'analysis');
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER analysis_views_assign_display_id
  BEFORE INSERT ON api.analysis_views
  FOR EACH ROW EXECUTE FUNCTION internal.assign_analysis_display_id();
--> statement-breakpoint
UPDATE api.sheet_instances
  SET display_id = internal.next_display_id(workspace_id, 'sheet')
  WHERE display_id IS NULL;
--> statement-breakpoint
UPDATE api.analysis_views
  SET display_id = internal.next_display_id(workspace_id, 'analysis')
  WHERE display_id IS NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.prevent_sheet_display_id_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF OLD.display_id IS NOT NULL
     AND NEW.display_id IS DISTINCT FROM OLD.display_id THEN
    RAISE EXCEPTION 'sheet display id is immutable' USING ERRCODE = 'SB072';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER prevent_sheet_display_id_change
  BEFORE UPDATE ON api.sheet_instances
  FOR EACH ROW EXECUTE FUNCTION internal.prevent_sheet_display_id_change();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.prevent_analysis_display_id_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF OLD.display_id IS NOT NULL
     AND NEW.display_id IS DISTINCT FROM OLD.display_id THEN
    RAISE EXCEPTION 'analysis display id is immutable' USING ERRCODE = 'SB072';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER prevent_analysis_display_id_change
  BEFORE UPDATE ON api.analysis_views
  FOR EACH ROW EXECUTE FUNCTION internal.prevent_analysis_display_id_change();
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
