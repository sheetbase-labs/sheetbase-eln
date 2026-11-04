-- Sequence files (GenBank and FASTA) can be listed without being opened.
--
-- When a sequence file is uploaded the app reads it and keeps a small summary
-- on the file: its name, whether it is DNA, RNA or protein, linear or circular,
-- its length, how many features it has and its GC content. Samples, records and
-- notebooks show that line next to the file, and the map viewer opens the file
-- itself, so the summary is only ever a convenience: it is never the sequence.

ALTER TABLE api.file_objects
    ADD COLUMN sequence_summary jsonb;
--> statement-breakpoint
ALTER TABLE api.file_objects
    ADD CONSTRAINT chk_file_objects_sequence_summary CHECK (
      sequence_summary IS NULL OR (
        jsonb_typeof(sequence_summary) = 'object'
        AND sequence_summary ->> 'molecule' IN ('dna', 'rna', 'protein')
        AND sequence_summary ->> 'topology' IN ('linear', 'circular')
        AND jsonb_typeof(sequence_summary -> 'length') = 'number'
        AND pg_column_size(sequence_summary) < 4096
      ));
--> statement-breakpoint
CREATE FUNCTION api.record_file_sequence(p_file_id uuid, p_summary jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid;
BEGIN
  IF api.has_capability(api.current_workspace_id(), 'work.records') IS NOT TRUE THEN RAISE EXCEPTION 'not permitted: needs work.records' USING ERRCODE = '42501'; END IF; -- capability-guard
  IF p_file_id IS NOT NULL THEN PERFORM internal.assert_object_access('file', p_file_id, 'edit'); END IF;
  SELECT workspace_id INTO v_workspace_id
    FROM api.file_objects WHERE id = p_file_id;
  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'unknown file' USING ERRCODE = '22023';
  END IF;
  IF NOT api.is_workspace_writer(v_workspace_id) THEN
    RAISE EXCEPTION 'caller cannot write to the workspace' USING ERRCODE = '42501';
  END IF;
  UPDATE api.file_objects
     SET sequence_summary = p_summary,
         updated_at = now()
   WHERE id = p_file_id;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION api.record_file_sequence(p_file_id uuid, p_summary jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.record_file_sequence(p_file_id uuid, p_summary jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.record_file_sequence(p_file_id uuid, p_summary jsonb) TO authenticated;
