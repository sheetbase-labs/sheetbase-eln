CREATE INDEX "idx_dataset_row_values_field_date" ON "api"."dataset_row_values" USING btree ("field_id","date_value");--> statement-breakpoint
CREATE INDEX "idx_dataset_row_values_field_timestamp" ON "api"."dataset_row_values" USING btree ("field_id","timestamp_value");
--> statement-breakpoint
CREATE FUNCTION api.query_dataset_rows(
  p_dataset_id uuid,
  p_query jsonb DEFAULT '{}'::jsonb,
  p_limit integer DEFAULT 200,
  p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  dataset api.datasets;
  filter_item jsonb;
  sort_item jsonb;
  field api.dataset_schema_version_fields;
  filter_sql text := '';
  base_sql text;
  sort_sql text := 'r.id';
  sort_direction text := 'ASC';
  value_column text;
  total_count bigint;
  rows jsonb;
  v_field_id uuid;
  operator text;
  value_text text;
BEGIN
  SELECT * INTO dataset FROM api.datasets
  WHERE id=p_dataset_id AND workspace_id=api.current_workspace_id()
    AND api.is_workspace_member(workspace_id);
  IF dataset.id IS NULL THEN RAISE EXCEPTION 'dataset denied' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(p_query) <> 'object' OR p_query - ARRAY['filters','sort'] <> '{}'::jsonb
     OR (p_query ? 'filters' AND jsonb_typeof(p_query->'filters') <> 'array')
     OR (p_query ? 'sort' AND jsonb_typeof(p_query->'sort') <> 'object') THEN
    RAISE EXCEPTION 'invalid Dataset query shape' USING ERRCODE='22023';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 OR p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'Dataset query limit must be 1 to 1000 and offset non-negative' USING ERRCODE='22023';
  END IF;
  IF coalesce(jsonb_array_length(p_query->'filters'),0) > 8 THEN
    RAISE EXCEPTION 'Dataset query supports at most eight filters' USING ERRCODE='22023';
  END IF;

  FOR filter_item IN SELECT value FROM jsonb_array_elements(coalesce(p_query->'filters','[]'::jsonb)) LOOP
    IF jsonb_typeof(filter_item) <> 'object' OR filter_item - ARRAY['fieldId','operator','value'] <> '{}'::jsonb
       OR jsonb_typeof(filter_item->'fieldId') <> 'string' OR jsonb_typeof(filter_item->'operator') <> 'string'
       OR NOT (filter_item ? 'value') THEN RAISE EXCEPTION 'invalid Dataset filter shape' USING ERRCODE='22023'; END IF;
    BEGIN v_field_id := (filter_item->>'fieldId')::uuid; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid Dataset field id' USING ERRCODE='22023'; END;
    SELECT * INTO field FROM api.dataset_schema_version_fields f
    WHERE f.schema_version_id=dataset.schema_version_id AND f.field_id=v_field_id AND f.lifecycle='active';
    IF field.id IS NULL THEN RAISE EXCEPTION 'unknown active Dataset field' USING ERRCODE='22023'; END IF;
    operator := filter_item->>'operator';
    IF operator NOT IN ('eq','gt','gte','lt','lte') OR (operator <> 'eq' AND field.logical_type NOT IN ('integer','decimal','date','timestamp')) THEN
      RAISE EXCEPTION 'unsupported Dataset filter operator' USING ERRCODE='22023';
    END IF;
    value_text := filter_item->'value' #>> '{}';
    value_column := CASE field.logical_type
      WHEN 'text' THEN 'text_value'
      WHEN 'integer' THEN 'integer_value'
      WHEN 'decimal' THEN 'numeric_value'
      WHEN 'boolean' THEN 'boolean_value'
      WHEN 'date' THEN 'date_value'
      WHEN 'timestamp' THEN 'timestamp_value'
      WHEN 'category' THEN 'category_option_id'
      WHEN 'reference' THEN 'reference_id'
    END;
    BEGIN
      IF field.logical_type='integer' THEN PERFORM value_text::bigint;
      ELSIF field.logical_type='decimal' THEN PERFORM value_text::numeric;
      ELSIF field.logical_type='boolean' THEN PERFORM value_text::boolean;
      ELSIF field.logical_type='date' THEN PERFORM value_text::date;
      ELSIF field.logical_type='timestamp' THEN PERFORM value_text::timestamptz;
      ELSIF field.logical_type IN ('category','reference') THEN PERFORM value_text::uuid;
      END IF;
    EXCEPTION WHEN others THEN RAISE EXCEPTION 'Dataset filter value does not match field type' USING ERRCODE='22023'; END;
    filter_sql := filter_sql || format(' AND EXISTS (SELECT 1 FROM api.dataset_row_values v WHERE v.row_id=r.id AND v.field_id=%L::uuid AND v.%I %s %L::%s)',v_field_id,value_column,CASE operator WHEN 'eq' THEN '=' WHEN 'gt' THEN '>' WHEN 'gte' THEN '>=' WHEN 'lt' THEN '<' ELSE '<=' END,value_text,CASE field.logical_type WHEN 'integer' THEN 'bigint' WHEN 'decimal' THEN 'numeric' WHEN 'boolean' THEN 'boolean' WHEN 'date' THEN 'date' WHEN 'timestamp' THEN 'timestamptz' WHEN 'category' THEN 'uuid' WHEN 'reference' THEN 'uuid' ELSE 'text' END);
  END LOOP;

  IF p_query ? 'sort' THEN
    sort_item := p_query->'sort';
    IF sort_item - ARRAY['fieldId','direction'] <> '{}'::jsonb OR jsonb_typeof(sort_item->'fieldId') <> 'string' OR sort_item->>'direction' NOT IN ('asc','desc') THEN RAISE EXCEPTION 'invalid Dataset sort shape' USING ERRCODE='22023'; END IF;
    BEGIN v_field_id := (sort_item->>'fieldId')::uuid; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid Dataset field id' USING ERRCODE='22023'; END;
    SELECT * INTO field FROM api.dataset_schema_version_fields f WHERE f.schema_version_id=dataset.schema_version_id AND f.field_id=v_field_id AND f.lifecycle='active';
    IF field.id IS NULL THEN RAISE EXCEPTION 'unknown active Dataset field' USING ERRCODE='22023'; END IF;
    value_column := CASE field.logical_type WHEN 'text' THEN 'text_value' WHEN 'integer' THEN 'integer_value' WHEN 'decimal' THEN 'numeric_value' WHEN 'boolean' THEN 'boolean_value' WHEN 'date' THEN 'date_value' WHEN 'timestamp' THEN 'timestamp_value' WHEN 'category' THEN 'category_option_id' ELSE 'reference_id' END;
    sort_sql := format('(SELECT v.%I FROM api.dataset_row_values v WHERE v.row_id=r.id AND v.field_id=%L::uuid)',value_column,v_field_id);
    sort_direction := upper(sort_item->>'direction');
  END IF;

  base_sql := format(' FROM api.dataset_rows r WHERE r.dataset_id=%L::uuid',dataset.id) || filter_sql;
  EXECUTE 'SELECT count(*)' || base_sql INTO total_count;
  EXECUTE 'SELECT coalesce(jsonb_agg(jsonb_build_object(''rowId'',p.id,''revision'',p.revision,''values'',p.values) ORDER BY p.sort_value ' || sort_direction || ' NULLS LAST,p.id),''[]''::jsonb) FROM (SELECT r.id,r.revision,' ||
    sort_sql || ' AS sort_value,(SELECT coalesce(jsonb_object_agg(f.field_id::text,CASE f.logical_type WHEN ''text'' THEN to_jsonb(v.text_value) WHEN ''integer'' THEN to_jsonb(v.integer_value) WHEN ''decimal'' THEN to_jsonb(v.numeric_value) WHEN ''boolean'' THEN to_jsonb(v.boolean_value) WHEN ''date'' THEN to_jsonb(v.date_value) WHEN ''timestamp'' THEN to_jsonb(v.timestamp_value) WHEN ''category'' THEN to_jsonb(v.category_option_id) ELSE to_jsonb(v.reference_id) END),''{}''::jsonb) FROM api.dataset_schema_version_fields f LEFT JOIN api.dataset_row_values v ON v.row_id=r.id AND v.field_id=f.field_id WHERE f.schema_version_id=' || quote_literal(dataset.schema_version_id) || '::uuid) values' || base_sql || ' ORDER BY ' || sort_sql || ' ' || sort_direction || format(' NULLS LAST,r.id ASC LIMIT %s OFFSET %s) p',p_limit,p_offset) INTO rows;
  RETURN jsonb_build_object('datasetId',dataset.id,'datasetRevision',dataset.revision,'offset',p_offset,'limit',p_limit,'totalCount',total_count,'hasMore',p_offset+p_limit<total_count,'rows',rows);
END $$;
REVOKE EXECUTE ON FUNCTION api.query_dataset_rows(uuid,jsonb,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.query_dataset_rows(uuid,jsonb,integer,integer) TO authenticated;
NOTIFY pgrst, 'reload schema';
