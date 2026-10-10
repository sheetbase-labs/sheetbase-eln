CREATE TABLE "api"."work_item_views" (
	"user_id" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"item_key" text NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_views_user_id_item_key_pk" PRIMARY KEY("user_id","item_key")
);
--> statement-breakpoint
ALTER TABLE "api"."work_item_views" ADD CONSTRAINT "work_item_views_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "internal"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."work_item_views" ADD CONSTRAINT "work_item_views_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_work_item_views_workspace" ON "api"."work_item_views" USING btree ("workspace_id");--> statement-breakpoint
-- RM-116 — Inbox read state. A person reads and writes only their own rows.
ALTER TABLE api.work_item_views ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY work_item_views_select ON api.work_item_views
  FOR SELECT TO authenticated
  USING (user_id = api.current_user_id() AND workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON api.work_item_views TO authenticated;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.mark_work_items_seen(p_item_keys text[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_workspace uuid := api.current_workspace_id();
  v_user text := api.current_user_id();
  v_key text;
  v_count integer := 0;
BEGIN
  IF v_user IS NULL OR v_workspace IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  IF NOT api.is_workspace_member(v_workspace) THEN
    RAISE EXCEPTION 'not a workspace member' USING ERRCODE = '42501';
  END IF;
  FOREACH v_key IN ARRAY coalesce(p_item_keys, ARRAY[]::text[]) LOOP
    IF length(btrim(v_key)) = 0 OR length(v_key) > 400 THEN
      CONTINUE;
    END IF;
    INSERT INTO api.work_item_views (user_id, workspace_id, item_key, seen_at)
    VALUES (v_user, v_workspace, v_key, now())
    ON CONFLICT (user_id, item_key) DO UPDATE SET seen_at = now();
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.mark_work_items_seen(text[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.mark_work_items_seen(text[]) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
