-- Preview hashes deliberately omit submit-time binding metadata. Stored
-- integrity and signatures must instead cover the exact immutable snapshot.
-- Do not rewrite historical evidence; inconsistent old submissions require
-- withdrawal and resubmission, never an in-place digest repair.
DO $$
DECLARE definition text; original text; authored_retry text;
BEGIN
  definition := pg_get_functiondef('api.submit_record_revision(uuid,text,text,integer,text[],boolean,text,timestamptz,text,text)'::regprocedure);
  original := definition;
  IF position('''sha256'', actual_digest, ''submit''' IN definition) = 0
    OR position('existing_revision.integrity_digest <> p_expected_source_digest' IN definition) = 0
    OR position('EXCEPTION WHEN unique_violation THEN' IN definition) = 0 THEN
    RAISE EXCEPTION 'submission integrity anchors not found';
  END IF;
  definition := replace(definition, '  actual_digest text;',
    E'  actual_digest text;\n  snapshot_digest text;');
  definition := replace(definition, '  envelope := internal.build_revision_envelope(record_row.id);',
    E'  envelope := internal.build_revision_envelope(record_row.id);\n  snapshot_digest := internal.revision_integrity_digest(envelope);');
  definition := replace(definition, '''sha256'', actual_digest, ''submit''',
    '''sha256'', snapshot_digest, ''submit''');
  -- Both replay paths still compare the caller's source preview, but refuse
  -- historical snapshots whose stored integrity does not verify.
  definition := replace(definition,
    'existing_revision.integrity_digest <> p_expected_source_digest',
    'internal.revision_integrity_digest(internal.envelope_for_digest(existing_revision.canonical_snapshot)) IS DISTINCT FROM p_expected_source_digest
       OR existing_revision.integrity_digest IS DISTINCT FROM internal.revision_integrity_digest(existing_revision.canonical_snapshot)');
  definition := replace(definition,
    'IF author_signature.id IS NULL THEN',
    'IF author_signature.id IS NULL OR author_signature.revision_integrity_digest IS DISTINCT FROM existing_revision.integrity_digest THEN');
  -- The unique-violation recovery must return the same attestation under the
  -- same session/confirmation checks as the ordinary idempotent path.
  authored_retry := split_part(split_part(definition,
    '    IF requires_author THEN', 2), E'\n    RETURN jsonb_build_object(', 1);
  IF authored_retry = '' OR position('authored retry identity mismatch' IN authored_retry) = 0 THEN
    RAISE EXCEPTION 'authored retry anchor not found';
  END IF;
  definition := replace(definition,
    E'  RETURN jsonb_build_object(\n    ''revision'', jsonb_build_object(''id'', existing_revision.id',
    E'  IF requires_author THEN' || authored_retry || E'\n  RETURN jsonb_build_object(\n    ''revision'', jsonb_build_object(''id'', existing_revision.id');
  definition := replace(definition,
    E'    ''idempotent'', true\n  );',
    E'    ''signature'',signature_result,''idempotent'', true\n  );');
  IF definition = original OR position('snapshot_digest text' IN definition) = 0 THEN
    RAISE EXCEPTION 'submission integrity patch did not apply';
  END IF;
  EXECUTE definition;
END $$;
--> statement-breakpoint
-- All signature meanings share this persistence boundary, including authored
-- signatures created atomically by submission.
DO $$
DECLARE definition text; anchor text := '  SELECT * INTO STRICT r FROM api.revisions WHERE id=s.revision_id;';
BEGIN
  definition := pg_get_functiondef('internal.record_revision_signature(uuid,text,text,text,text)'::regprocedure);
  IF position(anchor IN definition) = 0 THEN
    RAISE EXCEPTION 'signature integrity anchor not found';
  END IF;
  definition := replace(definition, anchor, anchor || $guard$
  IF r.integrity_digest IS DISTINCT FROM internal.revision_integrity_digest(r.canonical_snapshot) THEN
    RAISE EXCEPTION 'revision integrity digest mismatch' USING ERRCODE='SB001';
  END IF;$guard$);
  EXECUTE definition;
END $$;
