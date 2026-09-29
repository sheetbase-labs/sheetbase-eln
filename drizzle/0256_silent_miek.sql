CREATE TABLE "api"."record_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	CONSTRAINT "chk_record_aliases_alias" CHECK (length(btrim("api"."record_aliases"."alias")) BETWEEN 1 AND 120)
);
--> statement-breakpoint
ALTER TABLE "api"."record_aliases" ADD CONSTRAINT "record_aliases_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."record_aliases" ADD CONSTRAINT "record_aliases_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "api"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."record_aliases" ADD CONSTRAINT "record_aliases_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_record_aliases_workspace_alias" ON "api"."record_aliases" USING btree ("workspace_id",lower("alias"));--> statement-breakpoint
CREATE INDEX "idx_record_aliases_record" ON "api"."record_aliases" USING btree ("record_id");--> statement-breakpoint
-- LAB-06 — record aliases ("also known as"). Members read; writes only
-- through the RPCs, which check the workspace and the writer capability.
ALTER TABLE api.record_aliases ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY record_aliases_select ON api.record_aliases
  FOR SELECT TO authenticated
  USING (
    workspace_id = api.current_workspace_id()
    AND api.is_workspace_member(workspace_id)
  );
--> statement-breakpoint
CREATE POLICY record_aliases_client_select ON api.record_aliases
  FOR SELECT TO api_client
  USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON api.record_aliases TO authenticated;
--> statement-breakpoint
GRANT SELECT ON api.record_aliases TO api_client;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.add_record_alias(p_record_id uuid, p_alias text)
RETURNS api.record_aliases
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v api.record_aliases;
  r api.records;
  v_alias text := btrim(coalesce(p_alias, ''));
BEGIN
  SELECT * INTO r FROM api.records WHERE id = p_record_id;
  IF r.id IS NULL
     OR api.current_workspace_id() IS DISTINCT FROM r.workspace_id
     OR NOT api.is_workspace_writer(r.workspace_id)
     OR NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END IF;
  IF length(v_alias) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'invalid alias' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.record_aliases (workspace_id, record_id, alias, created_by_user_id)
  VALUES (r.workspace_id, r.id, v_alias, api.current_user_id())
  ON CONFLICT (workspace_id, (lower(alias))) DO NOTHING
  RETURNING * INTO v;
  IF v.id IS NULL THEN
    SELECT * INTO v FROM api.record_aliases
      WHERE workspace_id = r.workspace_id AND lower(alias) = lower(v_alias);
    IF v.record_id <> r.id THEN
      RAISE EXCEPTION 'alias already in use' USING ERRCODE = 'SB072';
    END IF;
  END IF;
  RETURN v;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.add_record_alias(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.add_record_alias(uuid, text) TO authenticated;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.remove_record_alias(p_record_id uuid, p_alias text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  r api.records;
BEGIN
  SELECT * INTO r FROM api.records WHERE id = p_record_id;
  IF r.id IS NULL
     OR api.current_workspace_id() IS DISTINCT FROM r.workspace_id
     OR NOT api.is_workspace_writer(r.workspace_id)
     OR NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END IF;
  DELETE FROM api.record_aliases
    WHERE record_id = r.id AND workspace_id = r.workspace_id
      AND lower(alias) = lower(btrim(coalesce(p_alias, '')));
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.remove_record_alias(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.remove_record_alias(uuid, text) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
