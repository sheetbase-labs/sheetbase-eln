-- PROJ-04.3 — file versions: a chain, a retention date, and no deletion.
--
-- The design's Files tab offers "upload new version" and states that raw files
-- are never edited or deleted. A new version keeps its own checksum and points at
-- the one it replaced, so every earlier file stays downloadable; retention comes
-- from the workspace policy (SET-01) at upload time.
ALTER TABLE api.file_objects
  ADD CONSTRAINT file_objects_previous_version_id_fk
  FOREIGN KEY (previous_version_id) REFERENCES api.file_objects(id)
  ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint

-- One *root* file per record stays the invariant every existing reader relies
-- on; a version is a new row that points at the one it replaced.
ALTER TABLE api.file_objects DROP CONSTRAINT file_objects_record_id_key;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_file_objects_record_root ON api.file_objects(record_id)
  WHERE previous_version_id IS NULL;
--> statement-breakpoint

CREATE INDEX idx_file_objects_previous_version ON api.file_objects(previous_version_id);
--> statement-breakpoint

-- Raw files are never deleted: the row and its bytes are retained.
CREATE OR REPLACE FUNCTION internal.refuse_file_object_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'raw files are retained and cannot be deleted' USING ERRCODE = 'SB118';
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.refuse_file_object_delete() FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint

DROP TRIGGER IF EXISTS refuse_file_object_delete ON api.file_objects;
--> statement-breakpoint
CREATE TRIGGER refuse_file_object_delete BEFORE DELETE ON api.file_objects
  FOR EACH ROW EXECUTE FUNCTION internal.refuse_file_object_delete();
--> statement-breakpoint

-- Upload a new version of an existing file: the next version in the chain, its
-- own checksum, and the workspace's retention applied.
CREATE OR REPLACE FUNCTION api.register_file_version(
  p_file_id uuid,
  p_display_name text,
  p_storage_key text,
  p_media_type text,
  p_byte_size bigint,
  p_checksum text
) RETURNS api.file_objects
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_previous api.file_objects;
  v_next integer;
  v_retention integer;
  v_row api.file_objects;
BEGIN
  SELECT * INTO v_previous FROM api.file_objects WHERE id = p_file_id FOR UPDATE;
  IF v_previous.id IS NULL OR v_previous.workspace_id IS DISTINCT FROM api.current_workspace_id() THEN
    RAISE EXCEPTION 'file not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF NOT api.is_workspace_writer(v_previous.workspace_id) THEN
    RAISE EXCEPTION 'capability required: workspace write' USING ERRCODE = '42501';
  END IF;
  IF NOT internal.can_access_object('record', v_previous.record_id, 'edit') THEN
    RAISE EXCEPTION 'record edit authority required' USING ERRCODE = '42501';
  END IF;
  IF p_storage_key IS NULL OR p_display_name IS NULL OR p_media_type IS NULL
     OR p_byte_size IS NULL OR p_checksum IS NULL THEN
    RAISE EXCEPTION 'a new version needs its name, storage key, media type, size and checksum'
      USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(max(version), 0) + 1 INTO v_next
    FROM api.file_objects
   WHERE record_id = v_previous.record_id
     AND (id = v_previous.id OR previous_version_id = v_previous.id);
  SELECT audit_retention_days INTO v_retention
    FROM api.workspace_settings WHERE workspace_id = v_previous.workspace_id;

  INSERT INTO api.file_objects(
    workspace_id, record_id, storage_key, display_name, media_type, byte_size,
    checksum, checksum_algorithm, status, storage_backend, version,
    previous_version_id, retention_until, created_by_user_id)
  VALUES (
    v_previous.workspace_id, v_previous.record_id, p_storage_key, p_display_name,
    p_media_type, p_byte_size, p_checksum, 'sha256', 'active',
    v_previous.storage_backend, v_next, v_previous.id,
    now() + make_interval(days => coalesce(v_retention, 2555)), api.current_user_id())
  RETURNING * INTO v_row;

  PERFORM internal.emit_change_event(v_previous.workspace_id, 'file', v_row.id, 'update',
    v_previous.record_id, NULL,
    jsonb_build_object('effect', 'new_version', 'version', v_next,
      'previousVersionId', v_previous.id));
  RETURN v_row;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.register_file_version(uuid,text,text,text,bigint,text) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.register_file_version(uuid,text,text,text,bigint,text) TO authenticated;
--> statement-breakpoint

-- Every version of a file, newest first, each still downloadable.
CREATE OR REPLACE FUNCTION api.file_version_chain(p_file_id uuid)
RETURNS TABLE(
  id uuid,
  version integer,
  display_name text,
  media_type text,
  byte_size bigint,
  checksum text,
  storage_key text,
  created_at timestamp with time zone,
  retention_until timestamp with time zone,
  current boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH RECURSIVE chain AS (
    SELECT f.* FROM api.file_objects f
     WHERE f.id = p_file_id
       AND f.workspace_id = api.current_workspace_id()
       AND api.is_workspace_member(f.workspace_id)
    UNION ALL
    SELECT f.* FROM api.file_objects f
      JOIN chain c ON f.previous_version_id = c.id
     WHERE f.workspace_id = api.current_workspace_id()
  ), newest AS (
    SELECT max(version) AS version FROM chain
  )
  SELECT c.id, c.version, c.display_name, c.media_type, c.byte_size, c.checksum,
         c.storage_key, c.created_at, c.retention_until, c.version = n.version
    FROM chain c, newest n
   ORDER BY c.version DESC
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.file_version_chain(uuid) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.file_version_chain(uuid) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
