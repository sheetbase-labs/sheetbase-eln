-- Making a solution from lots. A buffer, media or any other prep uses up quantities of
-- ingredient lots and becomes a new lot of its own. The new lot is linked to what it was
-- made from, so from a bottle on the shelf you can see exactly which lots went into it, and
-- from any ingredient lot you can see which preparations used it.
--
-- One call does it all: each ingredient lot is drawn down through the same ledger as any
-- other use, the new lot is registered with its own lot number, quantity and storage, and its
-- expiry defaults to the earliest expiry among its ingredients (the solution can be given a
-- shorter shelf life, never an unexamined longer one by accident).

CREATE TABLE api.material_ingredients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    product_record_id uuid NOT NULL,
    -- NULL once the ingredient lot is deleted; the snapshot below keeps the history readable.
    ingredient_record_id uuid,
    quantity numeric(18,6) NOT NULL,
    unit text,
    -- What the ingredient lot looked like when it was used.
    ingredient_identifier text NOT NULL,
    ingredient_title text NOT NULL,
    ingredient_lot text,
    ingredient_expiry date,
    position integer DEFAULT 0 NOT NULL,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT material_ingredients_pkey PRIMARY KEY (id),
    CONSTRAINT material_ingredients_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT material_ingredients_product_fk FOREIGN KEY (product_record_id) REFERENCES api.records(id) ON DELETE CASCADE,
    CONSTRAINT material_ingredients_ingredient_fk FOREIGN KEY (ingredient_record_id) REFERENCES api.records(id) ON DELETE SET NULL,
    CONSTRAINT chk_material_ingredients_quantity CHECK (quantity > 0),
    CONSTRAINT chk_material_ingredients_distinct CHECK (ingredient_record_id IS DISTINCT FROM product_record_id)
);
--> statement-breakpoint
ALTER TABLE api.material_ingredients OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_material_ingredients_product ON api.material_ingredients (product_record_id, position);
--> statement-breakpoint
CREATE INDEX idx_material_ingredients_ingredient ON api.material_ingredients (ingredient_record_id) WHERE ingredient_record_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE api.material_ingredients ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY material_ingredients_select ON api.material_ingredients FOR SELECT TO authenticated
    USING (api.is_workspace_member(workspace_id)
           AND EXISTS (SELECT 1 FROM api.records r
                        WHERE r.id = product_record_id
                          AND (r.project_id IS NULL OR internal.can_view_project(r.project_id))));
--> statement-breakpoint
GRANT SELECT ON TABLE api.material_ingredients TO authenticated;
--> statement-breakpoint

-- Prepare a solution. p_ingredients is a JSON array of {"recordId": uuid, "quantity": number};
-- each quantity is in the unit the ingredient lot is stocked in (the app does no unit
-- conversion). p_expiry NULL means "earliest ingredient expiry".
CREATE FUNCTION api.prepare_solution(
    p_project_id uuid,
    p_title text,
    p_lot text,
    p_quantity numeric,
    p_unit text,
    p_ingredients jsonb,
    p_expiry date DEFAULT NULL,
    p_storage text DEFAULT NULL,
    p_note text DEFAULT NULL
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_item jsonb;
  v_position integer := 0;
  v_ing_id uuid;
  v_qty numeric;
  v_src api.records;
  v_src_qty numeric;
  v_src_expiry date;
  v_src_unit text;
  v_earliest date;
  v_expiry date;
  v_product api.records;
  v_properties jsonb;
  v_ids uuid[] := ARRAY[]::uuid[];
  v_reason text;
  v_unit text;
BEGIN IF api.has_capability(v_workspace_id, 'work.samples') IS NOT TRUE THEN RAISE EXCEPTION 'not permitted: needs work.samples' USING ERRCODE = '42501'; END IF; -- capability-guard
  IF v_workspace_id IS NULL OR NOT api.is_workspace_writer(v_workspace_id) THEN
    RAISE EXCEPTION 'caller cannot write to the active workspace' USING ERRCODE = '42501';
  END IF;
  IF p_title IS NULL OR length(btrim(p_title)) = 0 THEN
    RAISE EXCEPTION 'a name for the solution is required' USING ERRCODE = '22023';
  END IF;
  IF p_lot IS NULL OR length(btrim(p_lot)) NOT BETWEEN 1 AND 64 THEN
    RAISE EXCEPTION 'a lot number is required' USING ERRCODE = '22023';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'a positive quantity is required' USING ERRCODE = '22023';
  END IF;
  IF p_ingredients IS NULL OR jsonb_typeof(p_ingredients) <> 'array' OR jsonb_array_length(p_ingredients) = 0 THEN
    RAISE EXCEPTION 'add at least one ingredient' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_ingredients) > 100 THEN
    RAISE EXCEPTION 'a solution can have at most 100 ingredients' USING ERRCODE = '22023';
  END IF;

  -- First pass: lock and check every ingredient before anything is drawn down, in a stable
  -- order so two preparations using the same lots cannot deadlock.
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_ingredients) ORDER BY value->>'recordId' LOOP
    BEGIN
      v_ing_id := (v_item->>'recordId')::uuid;
      v_qty := (v_item->>'quantity')::numeric;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'each ingredient needs a lot and a quantity' USING ERRCODE = '22023';
    END;
    IF v_ing_id IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'each ingredient needs a lot and a quantity above zero' USING ERRCODE = '22023';
    END IF;
    IF v_ing_id = ANY (v_ids) THEN
      RAISE EXCEPTION 'each lot can be listed once; add the amounts together' USING ERRCODE = '22023';
    END IF;
    v_ids := v_ids || v_ing_id;
    SELECT * INTO v_src FROM api.records
     WHERE id = v_ing_id AND workspace_id = v_workspace_id AND deleted_at IS NULL
     FOR UPDATE;
    IF v_src.id IS NULL OR v_src.kind <> 'material' THEN
      RAISE EXCEPTION 'an ingredient lot was not found' USING ERRCODE = 'SB036';
    END IF;
    PERFORM internal.assert_object_access('record', v_ing_id, 'edit');
    IF v_src.archived_at IS NOT NULL OR v_src.status NOT IN ('available', 'reserved') THEN
      RAISE EXCEPTION '% (%) cannot be used: it is %', v_src.title, v_src.identifier,
        CASE WHEN v_src.archived_at IS NOT NULL THEN 'archived' ELSE v_src.status END
        USING ERRCODE = 'SB004';
    END IF;
    v_src_expiry := NULLIF(v_src.properties->>'expiry', '')::date;
    IF v_src_expiry IS NOT NULL AND v_src_expiry < current_date THEN
      RAISE EXCEPTION '% (%) expired on %', v_src.title, v_src.identifier, to_char(v_src_expiry, 'YYYY-MM-DD')
        USING ERRCODE = 'SB004';
    END IF;
    v_src_qty := COALESCE(NULLIF(v_src.properties->>'quantity', '')::numeric, 0);
    IF v_qty > v_src_qty THEN
      RAISE EXCEPTION 'only % % of % (%) is in stock', v_src_qty, COALESCE(v_src.properties->>'unit', ''), v_src.title, v_src.identifier
        USING ERRCODE = 'SB006';
    END IF;
    IF v_src_expiry IS NOT NULL AND (v_earliest IS NULL OR v_src_expiry < v_earliest) THEN
      v_earliest := v_src_expiry;
    END IF;
  END LOOP;

  v_expiry := COALESCE(p_expiry, v_earliest);
  v_unit := nullif(btrim(coalesce(p_unit, '')), '');

  v_properties := jsonb_build_object('lot', btrim(p_lot), 'quantity', p_quantity)
    || CASE WHEN v_expiry IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('expiry', to_char(v_expiry, 'YYYY-MM-DD')) END
    || CASE WHEN v_unit IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('unit', v_unit) END
    || CASE WHEN nullif(btrim(coalesce(p_storage, '')), '') IS NULL THEN '{}'::jsonb
            ELSE jsonb_build_object('storage', btrim(p_storage)) END;

  v_product := api.create_record(p_project_id, 'material', btrim(p_title), 'available',
                                 ARRAY['Solution']::text[], v_properties);
  -- The lot page's own detail fields, where the workspace has declared them.
  UPDATE api.records r
     SET custom_fields = r.custom_fields || coalesce((
           SELECT jsonb_object_agg(d.field_name,
                    CASE d.field_name WHEN 'initial_quantity' THEN to_jsonb(p_quantity)
                                      ELSE to_jsonb(to_char(current_date, 'YYYY-MM-DD')) END)
             FROM api.record_field_definitions d
            WHERE d.workspace_id = v_workspace_id AND d.kind = 'material'
              AND d.lifecycle = 'active'
              AND d.field_name IN ('initial_quantity', 'received')), '{}'::jsonb)
   WHERE r.id = v_product.id
   RETURNING * INTO v_product;

  v_reason := 'Used to prepare ' || v_product.identifier
    || COALESCE(' · ' || nullif(btrim(coalesce(p_note, '')), ''), '');

  -- Second pass: draw each ingredient down through the ledger and record what went in.
  v_ids := ARRAY[]::uuid[];
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_ingredients) LOOP
    v_ing_id := (v_item->>'recordId')::uuid;
    v_qty := (v_item->>'quantity')::numeric;
    SELECT * INTO v_src FROM api.records WHERE id = v_ing_id;
    PERFORM api.record_reagent_movement(v_ing_id, 'consume', v_src.metadata_version, v_qty, v_reason);
    INSERT INTO api.material_ingredients
      (workspace_id, product_record_id, ingredient_record_id, quantity, unit,
       ingredient_identifier, ingredient_title, ingredient_lot, ingredient_expiry,
       position, created_by)
    VALUES
      (v_workspace_id, v_product.id, v_ing_id, v_qty, v_src.properties->>'unit',
       v_src.identifier, v_src.title, v_src.properties->>'lot',
       NULLIF(v_src.properties->>'expiry', '')::date,
       v_position, api.current_user_id());
    v_position := v_position + 1;
  END LOOP;

  -- The solution's own ledger starts with how it was made.
  INSERT INTO api.reagent_movements
    (workspace_id, reagent_record_id, operation, quantity_delta, resulting_quantity,
     unit, supplier, catalog_no, lot, expiry, reason, actor_user_id)
  VALUES
    (v_workspace_id, v_product.id, 'receive', p_quantity, p_quantity,
     v_unit, NULL, NULL, btrim(p_lot), v_expiry,
     'Prepared from ' || jsonb_array_length(p_ingredients) || ' lot' ||
       CASE WHEN jsonb_array_length(p_ingredients) = 1 THEN '' ELSE 's' END,
     api.current_user_id());

  PERFORM internal.emit_change_event(v_workspace_id, 'material', v_product.id, 'create',
    v_product.id, v_product.project_id,
    jsonb_build_object('action', 'solution-prepared', 'ingredients', jsonb_array_length(p_ingredients)));

  RETURN jsonb_build_object(
    'id', v_product.id,
    'identifier', v_product.identifier,
    'title', v_product.title,
    'projectId', v_product.project_id,
    'metadataVersion', v_product.metadata_version,
    'lot', btrim(p_lot),
    'expiry', CASE WHEN v_expiry IS NULL THEN NULL ELSE to_char(v_expiry, 'YYYY-MM-DD') END,
    'quantity', p_quantity,
    'unit', v_unit);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.prepare_solution(p_project_id uuid, p_title text, p_lot text, p_quantity numeric, p_unit text, p_ingredients jsonb, p_expiry date, p_storage text, p_note text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.prepare_solution(p_project_id uuid, p_title text, p_lot text, p_quantity numeric, p_unit text, p_ingredients jsonb, p_expiry date, p_storage text, p_note text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.prepare_solution(p_project_id uuid, p_title text, p_lot text, p_quantity numeric, p_unit text, p_ingredients jsonb, p_expiry date, p_storage text, p_note text) TO authenticated;
