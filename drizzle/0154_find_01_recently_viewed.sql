-- FIND-01: Recents & work resumption.
--
-- `api.recently_viewed` is the thin per-user view-tracking table. One row per
-- (user, object kind, object) with the last view time. Rows are written
-- exclusively through the `record_recent_view` SECURITY DEFINER RPC so the
-- user attribution always comes from request claims, never from a client
-- payload; the browser reads rows back under RLS for the home "Recent"
-- surface. Edited/reviewed recency is never stored here — it derives from the
-- canonical `change_events` audit trail at read time.
--
-- Note: the table DDL below is the drizzle-generated delta for
-- `src/db/schema.ts`. The generated file also re-emitted CREATE TABLE
-- statements for `api.agent_workflows`/`agent_workflow_steps`/
-- `agent_workflow_events` and the `agent_operation_policies.credential_id`
-- column because migrations 0150–0152 are custom SQL that the sparse
-- snapshot chain had not captured. Those statements are removed here —
-- 0150–0152 already created those objects and re-running them would fail.
-- The 0154 snapshot is a full-database checkpoint, so future generates diff
-- against the true current schema.

CREATE TABLE "api"."recently_viewed" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"object_kind" text NOT NULL,
	"object_id" uuid NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_recently_viewed_user_object" UNIQUE("user_id","object_kind","object_id"),
	CONSTRAINT "chk_recently_viewed_object_kind" CHECK ("api"."recently_viewed"."object_kind" IN ('record', 'dataset', 'sheet', 'project', 'notebook_template'))
);
--> statement-breakpoint
ALTER TABLE "api"."recently_viewed" ADD CONSTRAINT "recently_viewed_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."recently_viewed" ADD CONSTRAINT "recently_viewed_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "internal"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_recently_viewed_user_viewed" ON "api"."recently_viewed" USING btree ("user_id","viewed_at");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- record_recent_view — the only write path for view tracking.
--
-- Resolves the object's workspace from its canonical table, verifies the
-- caller is still a member (RLS-visible objects only), upserts the view
-- timestamp, and caps the per-user recents window server-side. Unknown or
-- no-longer-visible objects are silently ignored: tracking must never fail
-- a page render.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "api"."record_recent_view"(
  p_object_kind text,
  p_object_id uuid
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = api, internal, public
AS $$
DECLARE
  v_user_id text;
  v_workspace_id uuid;
  v_viewed_at timestamptz;
BEGIN
  v_user_id := "api"."current_user_id"();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'record_recent_view requires an authenticated user' USING ERRCODE = '42501';
  END IF;
  IF p_object_kind NOT IN ('record', 'dataset', 'sheet', 'project', 'notebook_template') THEN
    RAISE EXCEPTION 'unknown recent-object kind' USING ERRCODE = '22023';
  END IF;

  v_workspace_id := CASE p_object_kind
    WHEN 'record' THEN (
      SELECT r.workspace_id FROM api.records r
      WHERE r.id = p_object_id AND r.deleted_at IS NULL
    )
    WHEN 'dataset' THEN (
      SELECT d.workspace_id FROM api.datasets d WHERE d.id = p_object_id
    )
    WHEN 'sheet' THEN (
      SELECT s.workspace_id FROM api.sheet_instances s WHERE s.id = p_object_id
    )
    WHEN 'project' THEN (
      SELECT p.workspace_id FROM api.projects p WHERE p.id = p_object_id
    )
    WHEN 'notebook_template' THEN (
      SELECT t.workspace_id FROM api.notebook_templates t WHERE t.id = p_object_id
    )
  END;

  -- Unknown objects and objects whose workspace the caller can no longer see
  -- are ignored rather than erroring: view tracking is best-effort.
  IF v_workspace_id IS NULL OR NOT "api"."is_workspace_member"(v_workspace_id) THEN
    RETURN NULL;
  END IF;

  INSERT INTO "api"."recently_viewed"
    (workspace_id, user_id, object_kind, object_id, viewed_at)
  VALUES
    (v_workspace_id, v_user_id, p_object_kind, p_object_id, now())
  ON CONFLICT (user_id, object_kind, object_id)
  DO UPDATE SET viewed_at = EXCLUDED.viewed_at, workspace_id = EXCLUDED.workspace_id
  RETURNING viewed_at INTO v_viewed_at;

  -- Keep the table thin: retain only the most recent 200 objects per user.
  DELETE FROM "api"."recently_viewed"
  WHERE user_id = v_user_id
    AND (object_kind, object_id) NOT IN (
      SELECT object_kind, object_id
      FROM api.recently_viewed
      WHERE user_id = v_user_id
      ORDER BY viewed_at DESC, object_kind ASC, object_id ASC
      LIMIT 200
    );

  RETURN v_viewed_at;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON "api"."recently_viewed" FROM PUBLIC, anon, api_client;

--> statement-breakpoint

GRANT SELECT ON "api"."recently_viewed" TO authenticated;

--> statement-breakpoint

ALTER TABLE "api"."recently_viewed" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint

CREATE POLICY recently_viewed_select ON "api"."recently_viewed"
  FOR SELECT TO authenticated
  USING (user_id = "api"."current_user_id"());

--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."record_recent_view"(text, uuid) FROM PUBLIC, anon, api_client;

--> statement-breakpoint

GRANT EXECUTE ON FUNCTION "api"."record_recent_view"(text, uuid) TO authenticated;

--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
