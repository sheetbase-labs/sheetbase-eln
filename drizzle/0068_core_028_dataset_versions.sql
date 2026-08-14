CREATE TABLE api.dataset_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id uuid NOT NULL REFERENCES api.datasets(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES api.workspaces(id) ON DELETE RESTRICT,
  schema_version_id uuid NOT NULL REFERENCES api.dataset_schema_versions(id) ON DELETE RESTRICT,
  source_dataset_revision bigint NOT NULL,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id text REFERENCES internal."user"(id) ON DELETE SET NULL,
  CONSTRAINT chk_dataset_versions_label CHECK(length(btrim(label)) BETWEEN 1 AND 200)
);
CREATE INDEX idx_dataset_versions_dataset_revision ON api.dataset_versions(dataset_id,source_dataset_revision);
CREATE TABLE api.dataset_version_rows (
  dataset_version_id uuid NOT NULL REFERENCES api.dataset_versions(id) ON DELETE RESTRICT,
  row_id uuid NOT NULL,
  revision bigint NOT NULL,
  PRIMARY KEY(dataset_version_id,row_id)
);
CREATE TABLE api.dataset_version_values (
  dataset_version_id uuid NOT NULL,
  row_id uuid NOT NULL,
  field_id uuid NOT NULL,
  ordinal integer NOT NULL DEFAULT 0 CHECK(ordinal>=0),
  text_value text, integer_value bigint, numeric_value numeric, boolean_value boolean,
  date_value date, timestamp_value timestamptz, category_option_id uuid, reference_id uuid,
  PRIMARY KEY(dataset_version_id,row_id,field_id,ordinal),
  FOREIGN KEY(dataset_version_id,row_id) REFERENCES api.dataset_version_rows(dataset_version_id,row_id) ON DELETE RESTRICT
);
CREATE INDEX idx_dataset_version_values_field_numeric ON api.dataset_version_values(dataset_version_id,field_id,numeric_value);
CREATE INDEX idx_dataset_version_values_field_reference ON api.dataset_version_values(dataset_version_id,field_id,reference_id);

ALTER TABLE api.dataset_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE api.dataset_version_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE api.dataset_version_values ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON api.dataset_versions,api.dataset_version_rows,api.dataset_version_values TO authenticated;
CREATE POLICY dataset_versions_read ON api.dataset_versions FOR SELECT TO authenticated USING(workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id));
CREATE POLICY dataset_version_rows_read ON api.dataset_version_rows FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM api.dataset_versions v WHERE v.id=dataset_version_id AND v.workspace_id=api.current_workspace_id() AND api.is_workspace_member(v.workspace_id)));
CREATE POLICY dataset_version_values_read ON api.dataset_version_values FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM api.dataset_versions v WHERE v.id=dataset_version_id AND v.workspace_id=api.current_workspace_id() AND api.is_workspace_member(v.workspace_id)));

CREATE OR REPLACE FUNCTION internal.prevent_dataset_version_mutation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'Dataset Versions are immutable evidence' USING ERRCODE='SB072'; END $$;
CREATE TRIGGER prevent_dataset_version_mutation BEFORE UPDATE OR DELETE ON api.dataset_versions FOR EACH ROW EXECUTE FUNCTION internal.prevent_dataset_version_mutation();
CREATE TRIGGER prevent_dataset_version_row_mutation BEFORE UPDATE OR DELETE ON api.dataset_version_rows FOR EACH ROW EXECUTE FUNCTION internal.prevent_dataset_version_mutation();
CREATE TRIGGER prevent_dataset_version_value_mutation BEFORE UPDATE OR DELETE ON api.dataset_version_values FOR EACH ROW EXECUTE FUNCTION internal.prevent_dataset_version_mutation();

CREATE FUNCTION api.snapshot_dataset(p_dataset_id uuid,p_expected_dataset_revision bigint,p_label text)
RETURNS api.dataset_versions LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE dataset api.datasets; version api.dataset_versions;
BEGIN
 SELECT * INTO dataset FROM api.datasets WHERE id=p_dataset_id AND workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id) FOR UPDATE;
 IF dataset.id IS NULL THEN RAISE EXCEPTION 'dataset denied' USING ERRCODE='42501'; END IF;
 IF dataset.revision<>p_expected_dataset_revision THEN RAISE EXCEPTION 'stale Dataset revision' USING ERRCODE='SB001'; END IF;
 IF dataset.lifecycle<>'active' THEN RAISE EXCEPTION 'cannot snapshot archived Dataset' USING ERRCODE='22023'; END IF;
 INSERT INTO api.dataset_versions(dataset_id,workspace_id,schema_version_id,source_dataset_revision,label,created_by_user_id)
 VALUES(dataset.id,dataset.workspace_id,dataset.schema_version_id,dataset.revision,p_label,api.current_user_id()) RETURNING * INTO version;
 INSERT INTO api.dataset_version_rows(dataset_version_id,row_id,revision)
 SELECT version.id,id,revision FROM api.dataset_rows WHERE dataset_id=dataset.id;
 INSERT INTO api.dataset_version_values(dataset_version_id,row_id,field_id,ordinal,text_value,integer_value,numeric_value,boolean_value,date_value,timestamp_value,category_option_id,reference_id)
 SELECT version.id,v.row_id,v.field_id,v.ordinal,v.text_value,v.integer_value,v.numeric_value,v.boolean_value,v.date_value,v.timestamp_value,v.category_option_id,v.reference_id
 FROM api.dataset_row_values v JOIN api.dataset_rows r ON r.id=v.row_id WHERE r.dataset_id=dataset.id;
 RETURN version;
END $$;
REVOKE EXECUTE ON FUNCTION api.snapshot_dataset(uuid,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.snapshot_dataset(uuid,bigint,text) TO authenticated;

CREATE FUNCTION api.query_dataset_version_rows(p_dataset_version_id uuid,p_limit integer DEFAULT 200,p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE version api.dataset_versions;
BEGIN
 SELECT * INTO version FROM api.dataset_versions WHERE id=p_dataset_version_id AND workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id);
 IF version.id IS NULL THEN RAISE EXCEPTION 'Dataset Version denied' USING ERRCODE='42501'; END IF;
 IF p_limit NOT BETWEEN 1 AND 1000 OR p_offset<0 THEN RAISE EXCEPTION 'invalid Dataset Version window' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('datasetVersionId',version.id,'datasetId',version.dataset_id,'schemaVersionId',version.schema_version_id,'sourceDatasetRevision',version.source_dataset_revision,'offset',p_offset,'limit',p_limit,'totalCount',(SELECT count(*) FROM api.dataset_version_rows WHERE dataset_version_id=version.id),'rows',coalesce((SELECT jsonb_agg(jsonb_build_object('rowId',r.row_id,'revision',r.revision,'values',coalesce((SELECT jsonb_object_agg(field_id,values) FROM (SELECT field_id,CASE WHEN count(*)=1 THEN (jsonb_agg(coalesce(to_jsonb(text_value),to_jsonb(integer_value),to_jsonb(numeric_value),to_jsonb(boolean_value),to_jsonb(date_value),to_jsonb(timestamp_value),to_jsonb(category_option_id),to_jsonb(reference_id)) ORDER BY ordinal))->0 ELSE jsonb_agg(coalesce(to_jsonb(text_value),to_jsonb(integer_value),to_jsonb(numeric_value),to_jsonb(boolean_value),to_jsonb(date_value),to_jsonb(timestamp_value),to_jsonb(category_option_id),to_jsonb(reference_id)) ORDER BY ordinal) END values FROM api.dataset_version_values WHERE dataset_version_id=version.id AND row_id=r.row_id GROUP BY field_id) fields),'{}'::jsonb))) FROM (SELECT * FROM api.dataset_version_rows WHERE dataset_version_id=version.id ORDER BY row_id LIMIT p_limit OFFSET p_offset) r),'[]'::jsonb));
END $$;
REVOKE EXECUTE ON FUNCTION api.query_dataset_version_rows(uuid,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.query_dataset_version_rows(uuid,integer,integer) TO authenticated;
NOTIFY pgrst, 'reload schema';
