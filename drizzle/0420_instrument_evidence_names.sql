-- LAB-06.4 — the name an instrument had when a record was signed.
--
-- An instrument can be renamed, and a signed record must keep the name it used while showing
-- the current one beside it, so the name has to be captured at signing rather than read back
-- later. The association already exists: api.dataset_imports names both the experiment record
-- and the instrument the data came from, so a record's instruments are the ones its imports
-- came through - not a new link invented for this, and not the project's instrument runs, which
-- would attribute an unrelated run to the record.
--
-- The capture joins the envelope, which is what a revision freezes: metadata_snapshot is the
-- envelope's record section and canonical_snapshot is the whole envelope, so the names land in
-- frozen evidence without a second snapshot to keep in step. Only the identity and the name are
-- captured; the current name is read live at comparison time, which is what makes a rename
-- visible rather than silent.

CREATE OR REPLACE FUNCTION internal.record_instrument_evidence(p_record_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'instrumentId', i.id,
        'displayId', i.display_id,
        'name', i.name
      ) ORDER BY i.display_id, i.id
    ),
    '[]'::jsonb
  )
  FROM (
    SELECT DISTINCT di.instrument_id
    FROM api.dataset_imports di
    WHERE di.experiment_record_id = p_record_id
      AND di.instrument_id IS NOT NULL
      -- A preview or failed import did not produce the record's data, so it does not put the
      -- instrument's name into the record's evidence.
      AND di.status = 'committed'
  ) linked
  JOIN api.instruments i ON i.id = linked.instrument_id;
$function$;

REVOKE ALL ON FUNCTION internal.record_instrument_evidence(uuid) FROM PUBLIC;

-- The envelope carries the captured names from now on. Existing revisions keep the envelope
-- they were signed with; nothing is rewritten, and the drift read model treats a revision with
-- no instruments section as having none.
CREATE OR REPLACE FUNCTION internal.build_revision_envelope(p_record_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  base jsonb;
BEGIN
  base := internal.build_revision_envelope_without_sheet_evidence(p_record_id);
  RETURN base || jsonb_build_object(
    'sheetEvidence', internal.notebook_sheet_evidence(p_record_id),
    'instruments', internal.record_instrument_evidence(p_record_id)
  );
END
$function$;

NOTIFY pgrst, 'reload schema';
