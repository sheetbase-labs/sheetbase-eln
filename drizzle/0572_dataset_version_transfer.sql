-- A versioned, lossless read contract over canonical immutable Dataset Versions.
-- Existing row and ordinary file-export representations keep their semantics.
CREATE FUNCTION internal.transfer_exact_json(p_value jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE jsonb_typeof(p_value)
    WHEN 'number' THEN to_jsonb(p_value #>> '{}')
    WHEN 'array' THEN coalesce((SELECT jsonb_agg(internal.transfer_exact_json(value) ORDER BY ordinal)
      FROM jsonb_array_elements(p_value) WITH ORDINALITY a(value,ordinal)), '[]'::jsonb)
    WHEN 'object' THEN coalesce((SELECT jsonb_object_agg(key,internal.transfer_exact_json(value))
      FROM jsonb_each(p_value)), '{}'::jsonb)
    ELSE p_value END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.transfer_exact_json(jsonb) FROM PUBLIC,anon,authenticated,api_client;
--> statement-breakpoint

CREATE FUNCTION internal.dataset_version_transfer_rows(p_version_id uuid,p_limit bigint,p_offset bigint)
RETURNS TABLE(row_id uuid,canonical_json text,sha256 text)
LANGUAGE sql STABLE SET search_path='' SET timezone='UTC' SET datestyle='ISO, YMD' AS $$
  SELECT r.row_id, encoded.content, encode(sha256(convert_to(encoded.content,'UTF8')),'hex')
  FROM (SELECT * FROM api.dataset_version_rows WHERE dataset_version_id=p_version_id
        ORDER BY row_id LIMIT p_limit OFFSET p_offset) r
  JOIN api.dataset_versions version ON version.id=r.dataset_version_id
  CROSS JOIN LATERAL (
    SELECT internal.transfer_exact_json(jsonb_build_object(
      'rowId',r.row_id,'revision',r.revision,
      'values',coalesce((SELECT jsonb_object_agg(f.field_id::text,
        CASE WHEN f.cardinality='many' THEN coalesce(cell.items,'[]'::jsonb)
             ELSE coalesce(cell.items->0,'null'::jsonb) END)
        FROM api.dataset_schema_version_fields f
        CROSS JOIN LATERAL (
          SELECT jsonb_agg(coalesce(to_jsonb(v.text_value),to_jsonb(v.integer_value),
            to_jsonb(v.numeric_value),to_jsonb(v.boolean_value),to_jsonb(v.date_value),
            to_jsonb(v.timestamp_value),to_jsonb(v.category_option_id),to_jsonb(v.reference_id))
            ORDER BY v.ordinal) AS items
          FROM api.dataset_version_values v WHERE v.dataset_version_id=p_version_id
            AND v.row_id=r.row_id AND v.field_id=f.field_id
        ) cell WHERE f.schema_version_id=version.schema_version_id),'{}'::jsonb),
      'flags',coalesce((SELECT jsonb_agg(to_jsonb(flag) ORDER BY flag.field_id,flag.kind,flag.source)
        FROM api.dataset_version_flags flag
        WHERE flag.dataset_version_id=p_version_id AND flag.row_id=r.row_id),'[]'::jsonb)
    ))::text AS content
  ) encoded
  ORDER BY r.row_id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.dataset_version_transfer_rows(uuid,bigint,bigint) FROM PUBLIC,anon,authenticated,api_client;
--> statement-breakpoint

CREATE FUNCTION api.query_dataset_version_transfer(p_dataset_version_id uuid,p_limit integer DEFAULT 1000,p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path='' SET timezone='UTC' SET datestyle='ISO, YMD' AS $$
DECLARE version api.dataset_versions; schema_version api.dataset_schema_versions;
  total bigint; metadata_json text; metadata_checksum text; page_rows jsonb;
  page_hashes text; snapshot_checksum text; has_more boolean;
BEGIN
  SELECT * INTO version FROM api.dataset_versions
   WHERE id=p_dataset_version_id AND workspace_id=api.current_workspace_id()
     AND api.is_workspace_member(workspace_id);
  IF version.id IS NULL THEN RAISE EXCEPTION 'Dataset Version denied' USING ERRCODE='42501'; END IF;
  PERFORM internal.assert_object_access('dataset_version',version.id,'view');
  IF EXISTS (SELECT 1 FROM api.dataset_version_prunes WHERE dataset_version_id=version.id) THEN
    RAISE EXCEPTION 'Dataset Version rows were removed by retention' USING ERRCODE='22023';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 OR p_offset IS NULL OR p_offset<0 THEN
    RAISE EXCEPTION 'invalid Dataset Version transfer window' USING ERRCODE='22023';
  END IF;
  SELECT * INTO STRICT schema_version FROM api.dataset_schema_versions WHERE id=version.schema_version_id;
  SELECT count(*) INTO total FROM api.dataset_version_rows WHERE dataset_version_id=version.id;
  IF p_offset>total THEN RAISE EXCEPTION 'transfer offset exceeds row count' USING ERRCODE='22023'; END IF;
  metadata_json:=internal.transfer_exact_json(jsonb_build_object(
    'format','sheetbase.dataset-version-transfer/1',
    'workspaceId',version.workspace_id,'datasetId',version.dataset_id,
    'datasetVersionId',version.id,'schemaId',schema_version.schema_id,
    'schemaVersionId',version.schema_version_id,'schemaVersion',schema_version.version,
    'sourceDatasetRevision',version.source_dataset_revision,'label',version.label,
    'createdAt',version.created_at,'totalCount',total,
    'fields',coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.display_order,f.field_id)
      FROM api.dataset_schema_version_fields f WHERE f.schema_version_id=version.schema_version_id),'[]'::jsonb),
    'semantics',jsonb_build_object(
      'population','all snapshot rows and values, including flagged cells',
      'numericEncoding','every JSON number in metadataJson and canonicalJson is an exact decimal string',
      'nulls','missing scalar is null; missing many is []; order within many is preserved',
      'flags','all frozen flags; any flag excludes its cell in canonical pipeline input; no exclusion is applied to transfer values',
      'references','UUIDs only; referenced record state is live unless separately pinned',
      'rowStatus','planned/recorded status was not captured by Dataset Versions',
      'checksums','sha256 over UTF8; aggregate is metadataChecksum + LF + ordered row sha256 values each followed by LF'
    )))::text;
  metadata_checksum:=encode(sha256(convert_to(metadata_json,'UTF8')),'hex');
  SELECT coalesce(jsonb_agg(jsonb_build_object('rowId',r.row_id,'canonicalJson',r.canonical_json,'sha256',r.sha256) ORDER BY r.row_id),'[]'::jsonb),
    coalesce(string_agg(r.sha256||E'\n','' ORDER BY r.row_id),'')
    INTO page_rows,page_hashes FROM internal.dataset_version_transfer_rows(version.id,p_limit,p_offset) r;
  has_more:=p_offset::bigint+p_limit<total;
  IF NOT has_more THEN
    SELECT encode(sha256(convert_to(metadata_checksum||E'\n'||coalesce(string_agg(r.sha256||E'\n','' ORDER BY r.row_id),''),'UTF8')),'hex')
      INTO snapshot_checksum FROM internal.dataset_version_transfer_rows(version.id,NULL,0) r;
  END IF;
  RETURN jsonb_build_object('format','sheetbase.dataset-version-transfer/1',
    'metadataJson',metadata_json,'metadataChecksum',metadata_checksum,
    'offset',p_offset,'limit',p_limit,'totalCount',total,'hasMore',has_more,
    'rows',page_rows,'pageChecksum',encode(sha256(convert_to(metadata_checksum||E'\n'||page_hashes,'UTF8')),'hex'),
    'snapshotChecksum',snapshot_checksum);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.query_dataset_version_transfer(uuid,integer,integer) FROM PUBLIC,anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.query_dataset_version_transfer(uuid,integer,integer) TO authenticated,api_client;
--> statement-breakpoint
-- Ordinary row queries and file exports must not report retained identities
-- whose rows were pruned as valid empty snapshots either. Preserve their
-- existing representation and the object-access guard installed by SET-02.
DO $$
DECLARE definition text;
  anchor text := 'IF p_limit NOT BETWEEN 1 AND 1000';
BEGIN
  definition := pg_get_functiondef('api.query_dataset_version_rows(uuid,integer,integer)'::regprocedure);
  IF strpos(definition,anchor)=0 THEN
    RAISE EXCEPTION 'Dataset Version row-query retention guard anchor missing';
  END IF;
  EXECUTE replace(definition,anchor,
    'IF EXISTS (SELECT 1 FROM api.dataset_version_prunes WHERE dataset_version_id=version.id) THEN
       RAISE EXCEPTION ''Dataset Version rows were removed by retention'' USING ERRCODE=''22023'';
     END IF;
     ' || anchor);
END $$;
--> statement-breakpoint
NOTIFY pgrst,'reload schema';
