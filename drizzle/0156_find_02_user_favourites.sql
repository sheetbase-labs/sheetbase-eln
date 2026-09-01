-- FIND-02: Favourites & saved context.
--
-- `api.user_favourites` is the deliberate per-user pin table. One row per
-- (user, object kind, object) recording that the user explicitly favourited
-- the object. Unlike `recently_viewed` (FIND-01), rows are never
-- garbage-collected: a favourite is an explicit user decision, so there is no
-- activity cap. Rows are written exclusively through the
-- `set_record_favourite` SECURITY DEFINER RPC so user attribution always
-- comes from request claims, never from a client payload; the browser reads
-- rows back under RLS for the home "Favourites" surface and the star toggle
-- on canonical object pages.
--
-- Lifecycle behaviour: a favourite of an object that is later archived,
-- retired or (for records) deleted is HIDDEN from the read surfaces by the
-- application resolving canonical rows at read time — it is NOT deleted
-- here. Unfavouriting through the RPC is the only removal path, so restoring
-- the object brings the favourite back. Unfavouriting works even for objects
-- that have since been deleted or whose workspace the caller left: the
-- removal path below deletes the caller-owned pin BEFORE any
-- object-resolution or membership checks (creation keeps the checks).
--
-- RLS: direct SELECT is scoped to the caller's own rows AND to workspaces
-- the caller is still a member of. The user_id predicate alone would keep
-- exposing favourite metadata (kind, object id, workspace id, timestamps)
-- for objects in workspaces whose access has since been revoked.
--
-- Note: the table DDL below is the drizzle-generated delta for
-- `src/db/schema.ts`. Because 0154 is a full-database snapshot checkpoint,
-- this generate diffed cleanly against the current schema and emitted only
-- the new table — no earlier hand-authored DDL (0150–0153) was re-emitted.
-- The RPC, grants, and RLS policy below are hand-authored following the
-- 0154 pattern, as drizzle does not model functions or policies.

CREATE TABLE "api"."user_favourites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"object_kind" text NOT NULL,
	"object_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_user_favourites_user_object" UNIQUE("user_id","object_kind","object_id"),
	CONSTRAINT "chk_user_favourites_object_kind" CHECK ("api"."user_favourites"."object_kind" IN ('record', 'dataset', 'sheet', 'project', 'notebook_template'))
);
--> statement-breakpoint
ALTER TABLE "api"."user_favourites" ADD CONSTRAINT "user_favourites_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."user_favourites" ADD CONSTRAINT "user_favourites_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "internal"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_user_favourites_user_created" ON "api"."user_favourites" USING btree ("user_id","created_at");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- set_record_favourite — the only write path for favourites.
--
-- For p_favourite = true: resolves the object's workspace from its canonical
-- table, verifies the caller is still a member (RLS-visible objects only),
-- then upserts the pin. For p_favourite = false: deletes the CALLER-OWNED pin
-- immediately, BEFORE any object-resolution or membership check, so users can
-- unfavourite objects that have since been deleted or whose workspace they
-- left — the removal only ever touches rows where user_id is the caller, so
-- a caller can never remove another user's favourite. Unknown or
-- no-longer-visible objects cannot be (re)favourited but are ignored rather
-- than erroring: the star toggle is presentation-support state and must never
-- fail a page render. Returns the favourite's created_at when favourited,
-- NULL when removed or ignored.
--
-- Unlike `recently_viewed`, no retention cap: favourites are deliberate and
-- persist until the user unfavourites.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "api"."set_record_favourite"(
  p_object_kind text,
  p_object_id uuid,
  p_favourite boolean
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = api, internal, public
AS $$
DECLARE
  v_user_id text;
  v_workspace_id uuid;
  v_created_at timestamptz;
BEGIN
  v_user_id := "api"."current_user_id"();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'set_record_favourite requires an authenticated user' USING ERRCODE = '42501';
  END IF;
  IF p_object_kind NOT IN ('record', 'dataset', 'sheet', 'project', 'notebook_template') THEN
    RAISE EXCEPTION 'unknown favourite-object kind' USING ERRCODE = '22023';
  END IF;

  -- Unfavouriting (p_favourite = false) removes the CALLER-OWNED pin before
  -- any object-resolution or membership check: an object that has since been
  -- deleted (no canonical row) or whose workspace the caller left must still
  -- be unfavouritable. The user_id predicate makes this caller-scoped only;
  -- no other user's favourite can be touched.
  IF NOT p_favourite THEN
    DELETE FROM "api"."user_favourites"
    WHERE user_id = v_user_id
      AND object_kind = p_object_kind
      AND object_id = p_object_id;
    RETURN NULL;
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
  -- are ignored rather than erroring: favourites must never disturb the page.
  IF v_workspace_id IS NULL OR NOT "api"."is_workspace_member"(v_workspace_id) THEN
    RETURN NULL;
  END IF;

  IF p_favourite THEN
    INSERT INTO "api"."user_favourites"
      (workspace_id, user_id, object_kind, object_id, created_at)
    VALUES
      (v_workspace_id, v_user_id, p_object_kind, p_object_id, now())
    -- created_at is preserved on conflict: re-starring an existing favourite
    -- must not move it to the top of the home surface.
    ON CONFLICT (user_id, object_kind, object_id)
    DO UPDATE SET workspace_id = EXCLUDED.workspace_id
    RETURNING created_at INTO v_created_at;
    RETURN v_created_at;
  END IF;

  RETURN NULL;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON "api"."user_favourites" FROM PUBLIC, anon, api_client;

--> statement-breakpoint

GRANT SELECT ON "api"."user_favourites" TO authenticated;

--> statement-breakpoint

ALTER TABLE "api"."user_favourites" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint

CREATE POLICY user_favourites_select ON "api"."user_favourites"
  FOR SELECT TO authenticated
  USING (
    user_id = "api"."current_user_id"()
    -- Continued workspace visibility: a former member must not keep reading
    -- favourite metadata (kind, object id, workspace id, timestamps) for a
    -- workspace whose access was revoked. The same membership predicate the
    -- canonical object policies use (is_workspace_member: membership row
    -- with suspended_at IS NULL) gates every row's workspace.
    AND "api"."is_workspace_member"("api"."user_favourites"."workspace_id")
  );

--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."set_record_favourite"(text, uuid, boolean) FROM PUBLIC, anon, api_client;

--> statement-breakpoint

GRANT EXECUTE ON FUNCTION "api"."set_record_favourite"(text, uuid, boolean) TO authenticated;

--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
