-- SCI-01 follow-up: freezable faceted charts.
--
-- A faceted cartesian chart (line/scatter/bar with a facet field mapping)
-- can now be frozen: freeze_chart builds per-facet series (data.facets +
-- data.facetsTotal), each panel constructed exactly like its live
-- counterpart — groups in first-seen order, approved palette restarting per
-- panel, values sorted codepoint-style (COLLATE "C") and capped at twelve
-- with an honest total. Distribution/grid types keep their refusal: their
-- per-panel aggregation would double the snapshot machinery for a rare
-- combination, so the error stays explicit.

-- ---------------------------------------------------------------------------
-- freeze_chart — extended for faceted cartesian snapshots.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "api"."freeze_chart"(
  p_block_id uuid,
  p_expected_version int
)
RETURNS "api"."blocks"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_block "api"."blocks";
  v_owner "api"."records";
  v_spec jsonb;
  v_payload jsonb;
  v_dataset jsonb;
  v_table "api"."scientific_tables";
  v_columns jsonb;
  v_col "api"."scientific_columns";
  v_rows jsonb := '[]'::jsonb;
  v_filtered jsonb := '[]'::jsonb;
  v_row jsonb;
  v_filters jsonb;
  v_filter jsonb;
  v_fields jsonb;
  v_series_field text;
  v_x_field text;
  v_y_field text;
  v_err_field text;
  v_key text;
  v_series_map jsonb := '{}'::jsonb;
  v_series_arr jsonb := '[]'::jsonb;
  v_point jsonb;
  v_order text[] := ARRAY[]::text[];
  v_rowcount int;
  v_checksum text;
  v_provenance jsonb := '[]'::jsonb;
  v_frozen jsonb;
  v_display_series jsonb;
  v_configured jsonb;
  v_color text;
  v_label text;
  v_idx int := 0;
  v_pal text[] := ARRAY['#006EDC','#00A659','#9B61EA','#00A3BB','#E8A200'];
  v_col_meta jsonb := '[]'::jsonb;
  v_keep_field text;
  v_keep_fields text[];
  v_row_obj jsonb;
  -- SCI-01 distribution/grid state.
  v_ctype text;
  v_num float8;
  v_vals double precision[];
  v_edges double precision[];
  v_nbins int;
  v_xlo float8;
  v_xhi float8;
  v_xstep float8;
  v_ylo float8;
  v_yhi float8;
  v_ystep float8;
  v_counts int[];
  v_points jsonb;
  v_stats jsonb;
  v_heatmap jsonb;
  v_cells jsonb;
  v_cellmap jsonb;
  v_cellkey text;
  v_agg text;
  v_value_field text;
  v_x_type text;
  v_y_type text;
  v_xlabels text[];
  v_ylabels text[];
  v_dims int;
  v_dims_y int;
  v_xi int;
  v_yi int;
  v_cell jsonb;
  v_hmin float8;
  v_hmax float8;
  v_value float8;
  v_data jsonb;
  -- Faceted-freeze state (SCI-01 follow-up).
  v_facet_field text;
  v_facet_values text[];
  v_facets_total int;
  v_facet_series jsonb;
  v_facet_arr jsonb;
  v_fidx int;
  v_fkey text;
  v_pkey text;
  v_pmap jsonb;
  v_porder text[];
BEGIN
  SELECT * INTO v_block FROM "api"."blocks" WHERE id = p_block_id FOR UPDATE;
  IF v_block.id IS NULL THEN
    RAISE EXCEPTION 'block not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF v_block.type <> 'chart' THEN
    RAISE EXCEPTION 'block is not a chart' USING ERRCODE = '23514';
  END IF;
  IF v_block.version <> p_expected_version THEN
    RAISE EXCEPTION 'block version mismatch: expected %, got %',
      p_expected_version, v_block.version USING ERRCODE = 'SB001';
  END IF;
  IF jsonb_typeof(v_block.payload->'frozen') = 'object' THEN
    RAISE EXCEPTION 'chart is already frozen' USING ERRCODE = '23514';
  END IF;
  IF jsonb_typeof(v_block.payload->'spec') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid chart spec' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_owner FROM "api"."records" WHERE id = v_block.record_id;
  IF v_owner.id IS NULL THEN RAISE EXCEPTION 'block owner not found' USING ERRCODE = '23503'; END IF;
  -- SECURITY DEFINER bypasses RLS; re validate the caller actually owns the
  -- block's workspace before materialising anything.
  IF v_owner.workspace_id IS DISTINCT FROM "api"."current_workspace_id"()
     OR NOT "api"."is_workspace_member"(v_owner.workspace_id) THEN
    RAISE EXCEPTION 'block not found in active workspace' USING ERRCODE = '42501';
  END IF;

  v_spec := v_block.payload->'spec';
  v_fields := v_spec->'fields';
  v_y_field := v_fields->'y'->>'fieldName';
  v_x_field := v_fields->'x'->>'fieldName';
  v_series_field := v_fields->'series'->>'fieldName';
  v_err_field := v_spec->'overlays'->'errorBars'->>'fieldName';

  -- SCI-004 supports a single dataset (the spec array is forward-compatible).
  v_dataset := v_spec->'datasets'->0;
  SELECT * INTO v_table FROM "api"."scientific_tables"
    WHERE id = (v_dataset->>'tableId')::uuid AND lifecycle = 'active';
  IF v_table.id IS NULL OR v_table.workspace_id <> v_owner.workspace_id THEN
    RAISE EXCEPTION 'invalid dataset reference' USING ERRCODE = '23514';
  END IF;

  -- Active columns metadata, restricted to referenced fields for the frozen
  -- snapshot (keeps the payload lean and the tabular alternative honest).
  v_keep_fields := ARRAY_remove(ARRAY[
    v_x_field, v_y_field, v_series_field, v_err_field
  ]::text[], NULL);
  FOR v_col IN
    SELECT * FROM "api"."scientific_columns" c
      WHERE c.table_id = v_table.id AND c.lifecycle = 'active'
      ORDER BY c.display_order, c.id
  LOOP
    IF v_col.field_name = ANY(v_keep_fields) THEN
      v_col_meta := v_col_meta || jsonb_build_object(
        'columnId', v_col.id,
        'fieldName', v_col.field_name,
        'label', v_col.label,
        'unit', COALESCE(v_col.unit, 'null'::jsonb),
        'logicalType', v_col.logical_type
      );
    END IF;
  END LOOP;

  -- Read the dataset rows from the generated relation. RLS filters to the
  -- caller's workspace; the per-table CHECK pins a single workspace.
  v_filters := v_spec->'filters';
  FOR v_row IN
    EXECUTE format('SELECT to_jsonb(r) FROM api.%I r ORDER BY r.created_at, r.id', v_table.resource_name)
  LOOP
    v_rows := v_rows || jsonb_build_array(v_row);
  END LOOP;

  -- Apply explicit row predicates (mirrors src/lib/chart-spec applyFilters).
  IF jsonb_typeof(v_filters) = 'array' AND jsonb_array_length(v_filters) > 0 THEN
    FOR v_row IN SELECT value FROM jsonb_array_elements(v_rows) LOOP
      v_key := 'pass';
      FOR v_filter IN SELECT value FROM jsonb_array_elements(v_filters) LOOP
        IF NOT "api"."chart_filter_matches"(v_row, v_filter) THEN
          v_key := 'fail';
          EXIT;
        END IF;
      END LOOP;
      IF v_key = 'pass' THEN v_filtered := v_filtered || jsonb_build_array(v_row); END IF;
    END LOOP;
  ELSE
    v_filtered := v_rows;
  END IF;

  v_rowcount := jsonb_array_length(v_filtered);
  IF v_rowcount = 0 THEN
    RAISE EXCEPTION 'empty dataset' USING ERRCODE = '23514';
  END IF;

  v_checksum := md5(v_filtered::text);

  v_ctype := v_spec->>'type';
  v_facet_field := v_spec#>>'{fields,facet,fieldName}';
  -- Distribution/grid types keep their facet refusal: their aggregates are
  -- computed per panel live, and pinning per-facet grids doubles the
  -- snapshot machinery for a rare combination.
  IF v_facet_field IS NOT NULL
     AND v_ctype IN ('histogram','box','heatmap') THEN
    RAISE EXCEPTION '% charts cannot be frozen with facets', v_ctype
      USING ERRCODE='23514';
  END IF;

  IF v_ctype = 'heatmap' THEN
    -- ------------------------------------------------------------------
    -- Heatmap: aggregate the filtered rows into an x/y grid. Categorical
    -- dimensions use their distinct COLLATE "C" sorted values; numeric
    -- dimensions are binned (default 10). Cell values follow the spec's
    -- aggregate over valueField; counts ignore it. Mirrors
    -- materialiseHeatmap in src/lib/chart-spec.ts.
    -- ------------------------------------------------------------------
    v_agg := COALESCE(v_spec#>>'{typeParams,heatmap,aggregate}', 'count');
    v_value_field := v_spec#>>'{typeParams,heatmap,valueField,fieldName}';
    IF v_agg <> 'count' AND COALESCE(v_value_field, '') = '' THEN
      RAISE EXCEPTION 'heatmap valueField is required when aggregating anything but counts'
        USING ERRCODE='23514';
    END IF;

    BEGIN
      SELECT c.logical_type INTO v_x_type FROM "api"."scientific_columns" c
        WHERE c.id=(v_spec#>>'{fields,x,columnId}')::uuid AND c.lifecycle='active';
      SELECT c.logical_type INTO v_y_type FROM "api"."scientific_columns" c
        WHERE c.id=(v_spec#>>'{fields,y,columnId}')::uuid AND c.lifecycle='active';
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'invalid dataset reference' USING ERRCODE='23514';
    END;

    -- X dimension labels and binning range.
    IF COALESCE(v_x_type,'') IN ('category','text','boolean') THEN
      SELECT array_agg(k ORDER BY k COLLATE "C") INTO v_xlabels
        FROM (
          SELECT DISTINCT COALESCE(r->>(v_spec#>>'{fields,x,fieldName}'), '—') AS k
          FROM jsonb_array_elements(v_filtered) AS r
        ) t;
    ELSE
      v_nbins := COALESCE((v_spec#>>'{typeParams,heatmap,xBins}')::int, 10);
      v_xlo := NULL; v_xhi := NULL;
      FOR v_row IN SELECT value FROM jsonb_array_elements(v_filtered) LOOP
        v_num := "api"."chart_to_number"(v_row->>(v_spec#>>'{fields,x,fieldName}'));
        IF v_num IS NOT NULL THEN
          IF v_xlo IS NULL OR v_num < v_xlo THEN v_xlo := v_num; END IF;
          IF v_xhi IS NULL OR v_num > v_xhi THEN v_xhi := v_num; END IF;
        END IF;
      END LOOP;
      IF v_xlo IS NULL THEN v_xlo := 0; v_xhi := 1; END IF;
      IF v_xlo = v_xhi THEN v_xlo := v_xlo - 0.5; v_xhi := v_xhi + 0.5; END IF;
      v_xstep := (v_xhi - v_xlo) / v_nbins;
      v_xlabels := ARRAY(SELECT "api"."chart_dim_label"(v_xlo + i * v_xstep)
                         FROM generate_series(0, v_nbins - 1) AS g(i));
    END IF;

    -- Y dimension labels and binning range.
    IF COALESCE(v_y_type,'') IN ('category','text','boolean') THEN
      SELECT array_agg(k ORDER BY k COLLATE "C") INTO v_ylabels
        FROM (
          SELECT DISTINCT COALESCE(r->>(v_spec#>>'{fields,y,fieldName}'), '—') AS k
          FROM jsonb_array_elements(v_filtered) AS r
        ) t;
    ELSE
      v_dims_y := COALESCE((v_spec#>>'{typeParams,heatmap,yBins}')::int, 10);
      v_ylo := NULL; v_yhi := NULL;
      FOR v_row IN SELECT value FROM jsonb_array_elements(v_filtered) LOOP
        v_num := "api"."chart_to_number"(v_row->>(v_spec#>>'{fields,y,fieldName}'));
        IF v_num IS NOT NULL THEN
          IF v_ylo IS NULL OR v_num < v_ylo THEN v_ylo := v_num; END IF;
          IF v_yhi IS NULL OR v_num > v_yhi THEN v_yhi := v_num; END IF;
        END IF;
      END LOOP;
      IF v_ylo IS NULL THEN v_ylo := 0; v_yhi := 1; END IF;
      IF v_ylo = v_yhi THEN v_ylo := v_ylo - 0.5; v_yhi := v_yhi + 0.5; END IF;
      v_ystep := (v_yhi - v_ylo) / v_dims_y;
      v_ylabels := ARRAY(SELECT "api"."chart_dim_label"(v_ylo + i * v_ystep)
                         FROM generate_series(0, v_dims_y - 1) AS g(i));
    END IF;

    -- Accumulate cells keyed "xi,yi".
    v_cellmap := '{}'::jsonb;
    FOR v_row IN SELECT value FROM jsonb_array_elements(v_filtered) LOOP
      IF COALESCE(v_x_type,'') IN ('category','text','boolean') THEN
        SELECT i - 1 INTO v_xi FROM unnest(v_xlabels) WITH ORDINALITY AS u(k, i)
          WHERE k = COALESCE(v_row->>(v_spec#>>'{fields,x,fieldName}'), '—');
      ELSE
        v_num := "api"."chart_to_number"(v_row->>(v_spec#>>'{fields,x,fieldName}'));
        v_xi := NULL;
        IF v_num IS NOT NULL THEN
          v_xi := floor((v_num - v_xlo) / v_xstep)::int;
          IF v_xi >= v_nbins THEN v_xi := v_nbins - 1; END IF;
          IF v_xi < 0 THEN v_xi := 0; END IF;
        END IF;
      END IF;
      CONTINUE WHEN v_xi IS NULL OR v_xi < 0;
      IF COALESCE(v_y_type,'') IN ('category','text','boolean') THEN
        SELECT i - 1 INTO v_yi FROM unnest(v_ylabels) WITH ORDINALITY AS u(k, i)
          WHERE k = COALESCE(v_row->>(v_spec#>>'{fields,y,fieldName}'), '—');
      ELSE
        v_num := "api"."chart_to_number"(v_row->>(v_spec#>>'{fields,y,fieldName}'));
        v_yi := NULL;
        IF v_num IS NOT NULL THEN
          v_yi := floor((v_num - v_ylo) / v_ystep)::int;
          IF v_yi >= v_dims_y THEN v_yi := v_dims_y - 1; END IF;
          IF v_yi < 0 THEN v_yi := 0; END IF;
        END IF;
      END IF;
      CONTINUE WHEN v_yi IS NULL OR v_yi < 0;
      v_cellkey := v_xi::text || ',' || v_yi::text;
      v_cell := COALESCE(v_cellmap->v_cellkey,
                         '{"sum":0,"n":0,"count":0,"values":[]}'::jsonb);
      v_cell := jsonb_set(v_cell, '{count}',
        to_jsonb((v_cell->>'count')::int + 1));
      IF v_value_field IS NOT NULL THEN
        v_num := "api"."chart_to_number"(v_row->>v_value_field);
        IF v_num IS NOT NULL THEN
          v_cell := jsonb_set(jsonb_set(v_cell, '{sum}',
            to_jsonb((v_cell->>'sum')::float8 + v_num)), '{n}',
            to_jsonb((v_cell->>'n')::int + 1));
          v_cell := jsonb_set(v_cell, '{values}',
            (v_cell->'values') || to_jsonb(v_num));
        END IF;
      END IF;
      v_cellmap := jsonb_set(v_cellmap, ARRAY[v_cellkey], v_cell);
    END LOOP;

    -- Emit the grid row-major (x asc, y asc) like the client.
    v_dims := COALESCE(array_length(v_xlabels, 1), 0);
    v_dims_y := COALESCE(array_length(v_ylabels, 1), 0);
    v_cells := '[]'::jsonb;
    v_hmin := NULL; v_hmax := NULL;
    IF v_dims > 0 AND v_dims_y > 0 THEN
      FOR v_yi IN 0 .. v_dims_y - 1 LOOP
        FOR v_xi IN 0 .. v_dims - 1 LOOP
          v_cellkey := v_xi::text || ',' || v_yi::text;
          v_cell := v_cellmap->v_cellkey;
          v_value := NULL;
          IF v_agg = 'count' THEN
            v_value := COALESCE((v_cell->>'count')::float8, 0);
          ELSIF v_cell IS NOT NULL AND (v_cell->>'n')::int > 0 THEN
            IF v_agg = 'mean' THEN
              v_value := (v_cell->>'sum')::float8 / (v_cell->>'n')::int;
            ELSE
              v_vals := ARRAY(SELECT jsonb_array_elements_text(v_cell->'values')::float8);
              IF v_agg = 'median' THEN
                v_value := "api"."chart_quantile"(v_vals, 0.5);
              ELSIF v_agg = 'min' THEN
                SELECT min(x) INTO v_value FROM unnest(v_vals) AS t(x);
              ELSIF v_agg = 'max' THEN
                SELECT max(x) INTO v_value FROM unnest(v_vals) AS t(x);
              END IF;
            END IF;
          END IF;
          IF v_value IS NOT NULL THEN
            IF v_hmin IS NULL OR v_value < v_hmin THEN v_hmin := v_value; END IF;
            IF v_hmax IS NULL OR v_value > v_hmax THEN v_hmax := v_value; END IF;
          END IF;
          v_cells := v_cells || jsonb_build_object(
            'x', v_xi, 'y', v_yi, 'value', v_value,
            'count', COALESCE((v_cell->>'count')::int, 0));
        END LOOP;
      END LOOP;
    END IF;

    v_heatmap := jsonb_build_object(
      'xLabels', to_jsonb(v_xlabels),
      'yLabels', to_jsonb(v_ylabels),
      'cells', v_cells,
      'min', v_hmin,
      'max', v_hmax,
      'aggregate', v_agg
    );
    -- Heatmaps render no series.
    v_series_map := '{}'::jsonb;
    v_order := ARRAY[]::text[];
    v_series_arr := '[]'::jsonb;
  ELSE
    -- Build series groups in first-seen order.
  v_display_series := v_spec->'display'->'series';
  FOR v_row IN SELECT value FROM jsonb_array_elements(v_filtered) LOOP
    v_key := CASE WHEN v_series_field IS NULL THEN 'all'
                  ELSE COALESCE(v_row->>v_series_field, '—') END;
    IF NOT (v_series_map ? v_key) THEN
      v_series_map := jsonb_set(v_series_map, ARRAY[v_key], '[]'::jsonb);
      v_order := array_append(v_order, v_key);
    END IF;
    v_point := jsonb_build_object(
      'x', "api"."chart_to_number"(v_row->>v_x_field),
      'y', "api"."chart_to_number"(v_row->>v_y_field),
      'yError', CASE WHEN v_err_field IS NULL THEN NULL::numeric
                     ELSE "api"."chart_to_number"(v_row->>v_err_field) END,
      'label', v_key
    );
    v_series_map := jsonb_set(
      v_series_map, ARRAY[v_key],
      (v_series_map->v_key) || jsonb_build_array(v_point)
    );
  END LOOP;

  -- SCI-01: histogram/box replace raw points with aggregated statistics.
  IF v_ctype = 'histogram' THEN
    -- Shared edges across all groups so overlaid distributions stay
    -- comparable (mirrors materialiseHistogram).
    v_vals := ARRAY[]::double precision[];
    FOREACH v_key IN ARRAY v_order LOOP
      FOR v_row IN SELECT value FROM jsonb_array_elements(v_series_map->v_key) LOOP
        v_num := (v_row->>'y')::float8;
        IF v_num IS NOT NULL THEN v_vals := v_vals || v_num; END IF;
      END LOOP;
    END LOOP;
    IF v_vals IS NULL OR array_length(v_vals, 1) IS NULL THEN
      RAISE EXCEPTION 'empty dataset' USING ERRCODE='23514';
    END IF;
    SELECT min(x), max(x) INTO v_xlo, v_xhi FROM unnest(v_vals) AS t(x);
    v_num := COALESCE((v_spec#>>'{typeParams,histogram,binWidth}')::float8, 0);
    IF v_num > 0 THEN
      v_nbins := GREATEST(1, ceil((v_xhi - v_xlo) / v_num)::int);
      v_xhi := v_xhi + v_num * 0.0001;
    ELSE
      v_nbins := COALESCE((v_spec#>>'{typeParams,histogram,bins}')::int, 10);
    END IF;
    IF v_xlo = v_xhi THEN
      v_num := CASE WHEN abs(v_xlo) > 0 THEN abs(v_xlo) * 0.5 ELSE 0.5 END;
      v_xlo := v_xlo - v_num;
      v_xhi := v_xhi + v_num;
    END IF;
    v_xstep := (v_xhi - v_xlo) / v_nbins;
    v_edges := ARRAY(SELECT v_xlo + i * v_xstep
                     FROM generate_series(0, v_nbins) AS g(i));
    FOREACH v_key IN ARRAY v_order LOOP
      v_counts := ARRAY(SELECT 0 FROM generate_series(1, v_nbins));
      FOR v_row IN SELECT value FROM jsonb_array_elements(v_series_map->v_key) LOOP
        v_num := (v_row->>'y')::float8;
        CONTINUE WHEN v_num IS NULL;
        v_xi := floor((v_num - v_xlo) / v_xstep)::int;
        IF v_xi >= v_nbins THEN v_xi := v_nbins - 1; END IF;
        IF v_xi < 0 THEN v_xi := 0; END IF;
        v_counts[v_xi + 1] := v_counts[v_xi + 1] + 1;
      END LOOP;
      v_points := '[]'::jsonb;
      FOR v_xi IN 1 .. v_nbins LOOP
        v_points := v_points || jsonb_build_object(
          'x', v_edges[v_xi], 'y', v_counts[v_xi], 'yError', NULL, 'label', v_key);
      END LOOP;
      v_series_map := jsonb_set(v_series_map, ARRAY[v_key], v_points);
    END LOOP;
  ELSIF v_ctype = 'box' THEN
    v_yi := 0;
    FOREACH v_key IN ARRAY v_order LOOP
      v_yi := v_yi + 1;
      v_vals := ARRAY(
        SELECT (p->>'y')::float8
          FROM jsonb_array_elements(v_series_map->v_key) AS p
         WHERE (p->>'y')::float8 IS NOT NULL);
      IF v_vals IS NULL OR array_length(v_vals, 1) IS NULL THEN
        v_series_map := jsonb_set(v_series_map, ARRAY[v_key], '[]'::jsonb);
      ELSE
        v_stats := "api"."chart_box_stats"(v_vals);
        v_series_map := jsonb_set(v_series_map, ARRAY[v_key],
          jsonb_build_array(jsonb_build_object(
            'x', v_yi,
            'y', v_stats->'median',
            'yError', NULL,
            'label', v_key,
            'box', v_stats
          )));
      END IF;
    END LOOP;
  END IF;

  IF v_facet_field IS NOT NULL THEN
    -- Faceted cartesian snapshot replaces the single-plot series entirely.
    SELECT array_agg(k ORDER BY k COLLATE "C") INTO v_facet_values
      FROM (
        SELECT DISTINCT COALESCE(r->>v_facet_field, '—') AS k
        FROM jsonb_array_elements(v_filtered) AS r
      ) t;
    v_facets_total := COALESCE(array_length(v_facet_values, 1), 0);
    v_series_arr := '[]'::jsonb;
    v_facet_arr := '[]'::jsonb;
    FOR v_fidx IN 1 .. LEAST(v_facets_total, 12) LOOP
      v_fkey := v_facet_values[v_fidx];
      v_pmap := '{}'::jsonb;
      v_porder := ARRAY[]::text[];
      FOR v_row IN
        SELECT value FROM jsonb_array_elements(v_filtered) AS r
        WHERE COALESCE(r->>v_facet_field, '—') = v_fkey
      LOOP
        v_key := CASE WHEN v_series_field IS NULL THEN 'all'
                      ELSE COALESCE(v_row->>v_series_field, '—') END;
        IF NOT (v_pmap ? v_key) THEN
          v_pmap := jsonb_set(v_pmap, ARRAY[v_key], '[]'::jsonb);
          v_porder := array_append(v_porder, v_key);
        END IF;
        v_point := jsonb_build_object(
          'x', "api"."chart_to_number"(v_row->>v_x_field),
          'y', "api"."chart_to_number"(v_row->>v_y_field),
          'yError', CASE WHEN v_err_field IS NULL THEN NULL::numeric
                         ELSE "api"."chart_to_number"(v_row->>v_err_field) END,
          'label', v_key
        );
        v_pmap := jsonb_set(
          v_pmap, ARRAY[v_key],
          (v_pmap->v_key) || jsonb_build_array(v_point)
        );
      END LOOP;

      v_facet_series := '[]'::jsonb;
      v_idx := 0;
      FOREACH v_key IN ARRAY v_porder LOOP
        v_idx := v_idx + 1;
        v_configured := NULL;
        IF jsonb_typeof(v_display_series) = 'array' THEN
          FOR v_row IN SELECT value FROM jsonb_array_elements(v_display_series) LOOP
            IF v_row->>'identifier' = v_key THEN v_configured := v_row; EXIT; END IF;
          END LOOP;
        END IF;
        v_color := COALESCE(lower(v_configured->>'color'), lower(v_pal[v_idx]));
        v_label := COALESCE(v_configured->>'label', v_key);
        v_facet_series := v_facet_series || jsonb_build_array(jsonb_build_object(
          'identifier', v_key,
          'label', v_label,
          'color', v_color,
          'points', v_pmap->v_key
        ));
      END LOOP;

      v_facet_arr := v_facet_arr || jsonb_build_object('value', v_fkey, 'series', v_facet_series);
    END LOOP;
    v_series_map := '{}'::jsonb;
    v_order := ARRAY[]::text[];
  ELSE
  v_idx := 0;
  FOREACH v_key IN ARRAY v_order LOOP
    v_idx := v_idx + 1;
    IF v_ctype = 'box'
       AND jsonb_typeof(v_series_map->v_key) = 'array'
       AND jsonb_array_length(v_series_map->v_key) = 0 THEN
      CONTINUE;
    END IF;
    v_configured := NULL;
    IF jsonb_typeof(v_display_series) = 'array' THEN
      FOR v_row IN SELECT value FROM jsonb_array_elements(v_display_series) LOOP
        IF v_row->>'identifier' = v_key THEN v_configured := v_row; EXIT; END IF;
      END LOOP;
    END IF;
    v_color := COALESCE(lower(v_configured->>'color'), lower(v_pal[v_idx]));
    v_label := COALESCE(v_configured->>'label', v_key);
    v_series_arr := v_series_arr || jsonb_build_array(jsonb_build_object(
      'identifier', v_key,
      'label', v_label,
      'color', v_color,
      'points', v_series_map->v_key
    ));
  END LOOP;
  END IF; -- facet vs single-plot

  v_provenance := jsonb_build_array(jsonb_build_object(
    'tableId', v_table.id,
    'schemaVersion', v_table.schema_version,
    'rowCount', v_rowcount,
    'checksum', v_checksum
  ));

  -- Close the heatmap/cartesian branch; provenance and the frozen payload
  -- are common.
  END IF;

  v_data := jsonb_build_object(
    'columns', v_col_meta,
    'rows', v_filtered,
    'series', v_series_arr
  );
  IF v_heatmap IS NOT NULL THEN
    v_data := jsonb_set(v_data, '{heatmap}', v_heatmap);
  END IF;
  IF v_facet_arr IS NOT NULL
     AND jsonb_typeof(v_facet_arr) = 'array'
     AND jsonb_array_length(v_facet_arr) > 0 THEN
    v_data := jsonb_set(v_data, '{facets}', v_facet_arr);
    v_data := jsonb_set(v_data, '{facetsTotal}',
      COALESCE(to_jsonb(v_facets_total), '0'::jsonb));
  END IF;
  IF v_ctype = 'histogram' AND v_edges IS NOT NULL THEN
    v_data := jsonb_set(v_data, '{bins}',
      jsonb_build_object('edges', to_jsonb(v_edges)));
  END IF;

  v_frozen := jsonb_build_object(
    'revisionId', 'null'::jsonb,
    'frozenAt', to_jsonb(to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
    'frozenByUserId', to_jsonb("api"."current_user_id"()),
    'datasetProvenance', v_provenance,
    'data', v_data
  );

  v_payload := jsonb_set(v_block.payload, ARRAY['frozen'], v_frozen);

  UPDATE "api"."blocks"
    SET payload = v_payload,
        version = v_block.version + 1,
        updated_by_user_id = "api"."current_user_id"()
    WHERE id = p_block_id
    RETURNING * INTO v_block;

  RETURN v_block;
END;
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."freeze_chart"(uuid, int) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."freeze_chart"(uuid, int) TO authenticated;--> statement-breakpoint
NOTIFY pgrst, 'reload schema';--> statement-breakpoint
