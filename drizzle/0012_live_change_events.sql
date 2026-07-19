CREATE TABLE "api"."change_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"sequence" bigint NOT NULL,
	"entity_type" text NOT NULL,
	"entity_uuid" uuid NOT NULL,
	"operation" text NOT NULL,
	"record_id" uuid,
	"project_id" uuid,
	"actor_user_id" text,
	"client_id" text,
	"payload" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_change_events_workspace_sequence" UNIQUE("workspace_id","sequence"),
	CONSTRAINT "chk_change_events_entity_type" CHECK ("api"."change_events"."entity_type" IN ('project', 'folder', 'record', 'block', 'record_link')),
	CONSTRAINT "chk_change_events_operation" CHECK ("api"."change_events"."operation" IN ('create', 'update', 'move', 'delete', 'archive', 'restore', 'link', 'unlink'))
);
--> statement-breakpoint
CREATE TABLE "api"."workspace_change_seq" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api"."change_events" ADD CONSTRAINT "change_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."change_events" ADD CONSTRAINT "change_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."workspace_change_seq" ADD CONSTRAINT "workspace_change_seq_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_change_events_workspace_sequence" ON "api"."change_events" USING btree ("workspace_id","sequence");--> statement-breakpoint
CREATE INDEX "idx_change_events_workspace_record" ON "api"."change_events" USING btree ("workspace_id","record_id");--> statement-breakpoint
CREATE INDEX "idx_change_events_created_at" ON "api"."change_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_workspace_change_seq_workspace_id" ON "api"."workspace_change_seq" USING btree ("workspace_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- LIVE-001: durable workspace change events. Decision record 0016.
--
-- change_events is append-only and request-role read-only. No INSERT/UPDATE/
-- DELETE grants to authenticated or api_client: events are written
-- exclusively by the SECURITY DEFINER trigger functions below, which run as
-- the table owner (migrator) and so bypass RLS. Clients can neither write
-- nor forge events; they can only read events scoped to their workspace.
--
-- Every durable mutation to projects, folders, records, blocks and
-- record_links — whether through an RPC or direct PostgREST CRUD — fires an
-- AFTER trigger that derives the semantic operation from OLD/NEW, appends a
-- row with the next per-workspace sequence, and NOTIFYs a lightweight
-- pointer on the `sheetbase_change` channel so LIVE-002 SSE listeners can
-- refetch the durable event. The NOTIFY payload never carries the source of
-- truth; it points to the event row.
--
-- Event emission is skipped when no user claim is present (bootstrap, seed,
-- migration), so those paths stay quiet and the sequence reflects only real
-- user mutations.
-- ---------------------------------------------------------------------------

-- Grants. Read-only for request roles; no write path under any role.
GRANT SELECT ON "api"."change_events" TO authenticated;--> statement-breakpoint
GRANT SELECT ON "api"."change_events" TO api_client;--> statement-breakpoint
-- workspace_change_seq has no request-role grants at all; only the SECURITY
-- DEFINER emit helper (owner = migrator) reads and writes it.

-- RLS: members read their own workspace's events; no write policies.
ALTER TABLE "api"."change_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "change_events_select" ON "api"."change_events"
  FOR SELECT TO authenticated
  USING (
    workspace_id = "api"."current_workspace_id"()
    AND "api"."is_workspace_member"(workspace_id)
  );--> statement-breakpoint

-- api_client reads events scoped to its workspace token, mirroring the
-- existing api_client RLS pattern on the notebook domain.
CREATE POLICY "change_events_select_api_client" ON "api"."change_events"
  FOR SELECT TO api_client
  USING (workspace_id = "api"."current_workspace_id"());--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- internal.emit_change_event: the single writer. SECURITY DEFINER, owned by
-- migrator, pins search_path. Atomically reserves the next per-workspace
-- sequence via an upsert on workspace_change_seq (the PK row lock serialises
-- concurrent emitters in the same workspace), then appends the event and
-- NOTIFYs. No request-role EXECUTE grant: only the trigger functions (also
-- SECURITY DEFINER, running as migrator) call it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "internal"."emit_change_event"(
  p_workspace_id uuid,
  p_entity_type text,
  p_entity_uuid uuid,
  p_operation text,
  p_record_id uuid DEFAULT NULL,
  p_project_id uuid DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor text;
  v_client_id text;
  v_seq bigint;
  v_id uuid;
  v_claims jsonb;
BEGIN
  -- Actor and client identity come from the request JWT claims (set by the
  -- proxy). When absent (bootstrap/seed/migration), skip emission entirely
  -- so durable history reflects only real user mutations.
  v_claims := "api"."claim_probe"();
  IF v_claims IS NULL THEN
    RETURN;
  END IF;
  v_actor := v_claims ->> 'sub';
  IF v_actor IS NULL THEN
    RETURN;
  END IF;
  v_client_id := v_claims ->> 'client_id';

  -- Atomically reserve the next per-workspace sequence. The UNIQUE PK on
  -- workspace_change_seq serialises concurrent emitters: the INSERT ..
  -- ON CONFLICT DO UPDATE locks the row for the duration of this
  -- transaction, so sequences are gapless within a workspace.
  INSERT INTO "api"."workspace_change_seq" (workspace_id, last_seq)
    VALUES (p_workspace_id, 1)
    ON CONFLICT (workspace_id)
    DO UPDATE SET last_seq = "api"."workspace_change_seq".last_seq + 1,
                  updated_at = now()
    RETURNING last_seq INTO v_seq;

  v_id := gen_random_uuid();
  INSERT INTO "api"."change_events" (
    id, workspace_id, sequence, entity_type, entity_uuid, operation,
    record_id, project_id, actor_user_id, client_id, payload
  ) VALUES (
    v_id, p_workspace_id, v_seq, p_entity_type, p_entity_uuid, p_operation,
    p_record_id, p_project_id, v_actor, v_client_id, COALESCE(p_payload, '{}'::jsonb)
  );

  -- Lightweight pointer notification. LIVE-002 listeners refetch the event
  -- row by (workspace_id, sequence); the NOTIFY payload never carries the
  -- source of truth.
  PERFORM pg_notify(
    'sheetbase_change',
    jsonb_build_object(
      'workspace_id', p_workspace_id,
      'sequence', v_seq,
      'id', v_id,
      'entity_type', p_entity_type,
      'operation', p_operation
    )::text
  );
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "internal"."emit_change_event"(uuid, text, uuid, text, uuid, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
-- No grant to authenticated/api_client: only migrator-owned trigger
-- functions call this, and they run as migrator via SECURITY DEFINER.

-- ---------------------------------------------------------------------------
-- Trigger functions. Each derives the semantic operation from OLD/NEW and
-- calls emit_change_event with the right scoping ids. SECURITY DEFINER so
-- they can write to change_events regardless of the caller's role.
-- ---------------------------------------------------------------------------

-- records: create / archive / restore / update / delete
CREATE OR REPLACE FUNCTION "internal"."trg_change_event_records"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_op text;
  v_payload jsonb;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    v_op := 'create';
    v_payload := jsonb_build_object(
      'kind', NEW.kind, 'identifier', NEW.identifier, 'title', NEW.title,
      'status', NEW.status, 'structureVersion', NEW.structure_version,
      'metadataVersion', NEW.metadata_version
    );
    PERFORM "internal"."emit_change_event"(
      NEW.workspace_id, 'record', NEW.id, v_op, NEW.id, NEW.project_id, v_payload
    );
  ELSIF (TG_OP = 'UPDATE') THEN
    -- Derive the semantic operation from the archived_at transition first;
    -- otherwise it is a metadata/structure update.
    IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN
      v_op := 'archive';
    ELSIF OLD.archived_at IS NOT NULL AND NEW.archived_at IS NULL THEN
      v_op := 'restore';
    ELSE
      v_op := 'update';
    END IF;
    v_payload := jsonb_build_object(
      'title', NEW.title, 'status', NEW.status,
      'structureVersion', NEW.structure_version,
      'metadataVersion', NEW.metadata_version,
      'changedMetadata', (OLD.title IS DISTINCT FROM NEW.title
        OR OLD.status IS DISTINCT FROM NEW.status
        OR OLD.tags IS DISTINCT FROM NEW.tags
        OR OLD.folder_id IS DISTINCT FROM NEW.folder_id),
      'changedStructure', (OLD.structure_version IS DISTINCT FROM NEW.structure_version)
    );
    PERFORM "internal"."emit_change_event"(
      NEW.workspace_id, 'record', NEW.id, v_op, NEW.id, NEW.project_id, v_payload
    );
  ELSIF (TG_OP = 'DELETE') THEN
    PERFORM "internal"."emit_change_event"(
      OLD.workspace_id, 'record', OLD.id, 'delete', OLD.id, OLD.project_id,
      jsonb_build_object('identifier', OLD.identifier, 'kind', OLD.kind)
    );
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "internal"."trg_change_event_records"() FROM PUBLIC;--> statement-breakpoint

-- blocks: create / move / update / delete. record_id and project_id are
-- recovered via the parent record.
CREATE OR REPLACE FUNCTION "internal"."trg_change_event_blocks"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_op text;
  v_record_id uuid;
  v_workspace_id uuid;
  v_project_id uuid;
  v_payload jsonb;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    v_record_id := OLD.record_id;
    SELECT workspace_id, project_id INTO v_workspace_id, v_project_id
      FROM "api"."records" WHERE id = v_record_id;
    -- The parent record may already be gone (cascade). If so, the cascade
    -- already emitted a record 'delete' event; skip the per-block echo.
    IF v_workspace_id IS NULL THEN
      RETURN NULL;
    END IF;
    PERFORM "internal"."emit_change_event"(
      v_workspace_id, 'block', OLD.id, 'delete', v_record_id, v_project_id,
      jsonb_build_object('blockId', OLD.id, 'type', OLD.type, 'order', OLD."order")
    );
    RETURN NULL;
  END IF;

  v_record_id := NEW.record_id;
  SELECT workspace_id, project_id INTO v_workspace_id, v_project_id
    FROM "api"."records" WHERE id = v_record_id;
  IF v_workspace_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF (TG_OP = 'INSERT') THEN
    v_op := 'create';
    v_payload := jsonb_build_object('blockId', NEW.id, 'type', NEW.type, 'order', NEW."order");
  ELSIF (TG_OP = 'UPDATE') THEN
    -- A move changes order; a content edit changes payload/version. Order
    -- change wins as the semantic operation so LIVE-003 can refetch order.
    IF OLD."order" IS DISTINCT FROM NEW."order" THEN
      v_op := 'move';
    ELSE
      v_op := 'update';
    END IF;
    v_payload := jsonb_build_object(
      'blockId', NEW.id, 'type', NEW.type, 'order', NEW."order",
      'version', NEW.version, 'moved', (OLD."order" IS DISTINCT FROM NEW."order")
    );
  END IF;

  PERFORM "internal"."emit_change_event"(
    v_workspace_id, 'block', NEW.id, v_op, v_record_id, v_project_id, v_payload
  );
  RETURN NULL;
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "internal"."trg_change_event_blocks"() FROM PUBLIC;--> statement-breakpoint

-- record_links: link / unlink. record_id is the source record.
CREATE OR REPLACE FUNCTION "internal"."trg_change_event_record_links"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workspace_id uuid;
  v_project_id uuid;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    SELECT workspace_id, project_id INTO v_workspace_id, v_project_id
      FROM "api"."records" WHERE id = OLD.source_record_id;
    IF v_workspace_id IS NULL THEN
      RETURN NULL;
    END IF;
    PERFORM "internal"."emit_change_event"(
      v_workspace_id, 'record_link', OLD.id, 'unlink', OLD.source_record_id,
      v_project_id,
      jsonb_build_object('linkId', OLD.id, 'targetKind', OLD.target_kind,
        'targetIdentifier', OLD.target_identifier, 'linkType', OLD.link_type)
    );
    RETURN NULL;
  END IF;

  SELECT workspace_id, project_id INTO v_workspace_id, v_project_id
    FROM "api"."records" WHERE id = NEW.source_record_id;
  IF v_workspace_id IS NULL THEN
    RETURN NULL;
  END IF;
  PERFORM "internal"."emit_change_event"(
    v_workspace_id, 'record_link', NEW.id, 'link', NEW.source_record_id,
    v_project_id,
    jsonb_build_object('linkId', NEW.id, 'targetKind', NEW.target_kind,
      'targetIdentifier', NEW.target_identifier, 'linkType', NEW.link_type)
  );
  RETURN NULL;
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "internal"."trg_change_event_record_links"() FROM PUBLIC;--> statement-breakpoint

-- projects: create / update / delete.
CREATE OR REPLACE FUNCTION "internal"."trg_change_event_projects"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_op text;
  v_payload jsonb;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    v_op := 'create';
    v_payload := jsonb_build_object('key', NEW.key, 'title', NEW.title, 'status', NEW.status);
  ELSIF (TG_OP = 'UPDATE') THEN
    v_op := 'update';
    v_payload := jsonb_build_object('key', NEW.key, 'title', NEW.title, 'status', NEW.status);
  ELSIF (TG_OP = 'DELETE') THEN
    v_op := 'delete';
    v_payload := jsonb_build_object('key', OLD.key, 'title', OLD.title);
    PERFORM "internal"."emit_change_event"(
      OLD.workspace_id, 'project', OLD.id, v_op, NULL, OLD.id, v_payload
    );
    RETURN NULL;
  END IF;
  PERFORM "internal"."emit_change_event"(
    NEW.workspace_id, 'project', NEW.id, v_op, NULL, NEW.id, v_payload
  );
  RETURN NULL;
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "internal"."trg_change_event_projects"() FROM PUBLIC;--> statement-breakpoint

-- folders: create / update / delete.
CREATE OR REPLACE FUNCTION "internal"."trg_change_event_folders"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_op text;
  v_payload jsonb;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    v_op := 'create';
    v_payload := jsonb_build_object('identifier', NEW.identifier, 'name', NEW.name);
  ELSIF (TG_OP = 'UPDATE') THEN
    v_op := 'update';
    v_payload := jsonb_build_object('identifier', NEW.identifier, 'name', NEW.name);
  ELSIF (TG_OP = 'DELETE') THEN
    v_op := 'delete';
    v_payload := jsonb_build_object('identifier', OLD.identifier, 'name', OLD.name);
    PERFORM "internal"."emit_change_event"(
      OLD.workspace_id, 'folder', OLD.id, v_op, NULL, OLD.project_id, v_payload
    );
    RETURN NULL;
  END IF;
  PERFORM "internal"."emit_change_event"(
    NEW.workspace_id, 'folder', NEW.id, v_op, NULL, NEW.project_id, v_payload
  );
  RETURN NULL;
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "internal"."trg_change_event_folders"() FROM PUBLIC;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- AFTER triggers. AFTER (not BEFORE) so the row is committed for payload
-- derivation and DELETE has OLD available. One trigger per table covers all
-- three ops; the function branches on TG_OP.
-- ---------------------------------------------------------------------------
CREATE TRIGGER "change_event_records"
  AFTER INSERT OR UPDATE OR DELETE ON "api"."records"
  FOR EACH ROW EXECUTE FUNCTION "internal"."trg_change_event_records"();--> statement-breakpoint

CREATE TRIGGER "change_event_blocks"
  AFTER INSERT OR UPDATE OR DELETE ON "api"."blocks"
  FOR EACH ROW EXECUTE FUNCTION "internal"."trg_change_event_blocks"();--> statement-breakpoint

CREATE TRIGGER "change_event_record_links"
  AFTER INSERT OR UPDATE OR DELETE ON "api"."record_links"
  FOR EACH ROW EXECUTE FUNCTION "internal"."trg_change_event_record_links"();--> statement-breakpoint

CREATE TRIGGER "change_event_projects"
  AFTER INSERT OR UPDATE OR DELETE ON "api"."projects"
  FOR EACH ROW EXECUTE FUNCTION "internal"."trg_change_event_projects"();--> statement-breakpoint

CREATE TRIGGER "change_event_folders"
  AFTER INSERT OR UPDATE OR DELETE ON "api"."folders"
  FOR EACH ROW EXECUTE FUNCTION "internal"."trg_change_event_folders"();--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
