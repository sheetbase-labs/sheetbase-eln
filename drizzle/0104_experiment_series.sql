-- Series of experiments.
--
-- A series is an experiment that groups other experiments, for work that runs
-- over days or weeks as separate pieces, such as a cell assay with a seeding
-- run, a dosing run and a read-out run. Every member stays a full experiment
-- with its own owner, steps, review and signature; the series only says which
-- experiments belong together, in what order and on which day.
--
-- Membership is its own small table rather than a record link. A link is made
-- by someone who can edit the experiment it starts from, and an approved or
-- signed member is locked, so a link could not add it, move it or number it.
-- Here the person who runs the series edits the series, never its members, so
-- an approved member can be added and reordered, and the order, the planned
-- day and the roll-up all live in one place.
--
--   api.experiment_series          the experiments that act as a series;
--   api.experiment_series_members  which experiments are in which series,
--                                  with an order and a planned day;
--   api.start_experiment_series, api.dissolve_experiment_series,
--   api.add_series_member, api.remove_series_member,
--   api.move_series_member, api.set_series_member_day
--                                  the writes, run with the caller's rights;
--   api.series_members, api.series_rollup, api.record_series
--                                  the reads: the table on the series page, its
--                                  roll-up, and "3 of 5" on a member.
--
-- An experiment is in one series at most, a series cannot be a member of
-- another, and members are never changed by joining or leaving.

CREATE TABLE api.experiment_series (
    record_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_user_id text NOT NULL,
    CONSTRAINT experiment_series_pkey PRIMARY KEY (record_id),
    CONSTRAINT experiment_series_record_fk FOREIGN KEY (record_id) REFERENCES api.records(id) ON DELETE CASCADE,
    CONSTRAINT experiment_series_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE api.experiment_series OWNER TO migrator;
--> statement-breakpoint
CREATE TABLE api.experiment_series_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    series_record_id uuid NOT NULL,
    member_record_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    position real NOT NULL,
    planned_on date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_user_id text NOT NULL,
    CONSTRAINT experiment_series_members_pkey PRIMARY KEY (id),
    CONSTRAINT experiment_series_members_series_fk FOREIGN KEY (series_record_id) REFERENCES api.experiment_series(record_id) ON DELETE CASCADE,
    CONSTRAINT experiment_series_members_member_fk FOREIGN KEY (member_record_id) REFERENCES api.records(id) ON DELETE CASCADE,
    CONSTRAINT experiment_series_members_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT chk_experiment_series_members_apart CHECK (series_record_id <> member_record_id)
);
--> statement-breakpoint
ALTER TABLE api.experiment_series_members OWNER TO migrator;
--> statement-breakpoint
-- One series per experiment.
CREATE UNIQUE INDEX uq_experiment_series_members_member ON api.experiment_series_members (member_record_id);
--> statement-breakpoint
CREATE INDEX idx_experiment_series_members_series ON api.experiment_series_members (series_record_id, position);
--> statement-breakpoint
ALTER TABLE api.experiment_series ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE api.experiment_series_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY experiment_series_select ON api.experiment_series FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id() AND api.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY experiment_series_members_select ON api.experiment_series_members FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id() AND api.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY experiment_series_client_select ON api.experiment_series FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
CREATE POLICY experiment_series_members_client_select ON api.experiment_series_members FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.experiment_series, api.experiment_series_members TO authenticated, api_client;
--> statement-breakpoint

-- Webhooks, the live feed and pipeline triggers hear about members joining and
-- leaving. The event belongs to the series record.
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'api.change_events'::regclass
     AND conname = 'chk_change_events_entity_type';
  IF v_def IS NULL OR position('::text]' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for chk_change_events_entity_type';
  END IF;
  v_def := replace(v_def, '::text]', '::text, ''experiment_series_member''::text]');
  EXECUTE 'ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type';
  EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type ' || v_def;
END $$;
--> statement-breakpoint

INSERT INTO internal.webhook_event_names (name) VALUES
  ('experiment.series_member_added'), ('experiment.series_member_removed');
--> statement-breakpoint

CREATE FUNCTION internal.trg_change_event_series_member() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row api.experiment_series_members := CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  v_series api.records;
  v_member api.records;
BEGIN
  SELECT * INTO v_series FROM api.records WHERE id = v_row.series_record_id;
  SELECT * INTO v_member FROM api.records WHERE id = v_row.member_record_id;
  -- The whole series or the member is being deleted: there is no one left to tell.
  IF v_series.id IS NULL OR v_member.id IS NULL THEN
    RETURN NULL;
  END IF;
  PERFORM internal.emit_change_event(v_row.workspace_id, 'experiment_series_member', v_row.id,
    CASE TG_OP WHEN 'DELETE' THEN 'delete' ELSE 'create' END,
    v_row.series_record_id, v_series.project_id,
    jsonb_build_object('change', CASE TG_OP WHEN 'DELETE' THEN 'removed' ELSE 'added' END,
                       'seriesRecordId', v_series.id,
                       'seriesIdentifier', v_series.identifier,
                       'seriesTitle', v_series.title,
                       'memberRecordId', v_member.id,
                       'memberIdentifier', v_member.identifier,
                       'memberTitle', v_member.title,
                       'position', v_row.position));
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_change_event_series_member() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER change_event_series_member AFTER INSERT OR DELETE ON api.experiment_series_members
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_series_member();
--> statement-breakpoint

-- The caller may change this series: it is an experiment in the active
-- workspace that is not archived or locked, and they can edit it.
CREATE FUNCTION internal.series_for_edit(p_record_id uuid) RETURNS api.records
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_record api.records;
BEGIN
  SELECT * INTO v_record FROM api.records WHERE id = p_record_id;
  IF v_record.id IS NULL
     OR v_record.workspace_id IS DISTINCT FROM api.current_workspace_id()
     OR v_record.deleted_at IS NOT NULL
     OR NOT internal.can_access_object('record', v_record.id, 'view') THEN
    RAISE EXCEPTION 'experiment not found' USING ERRCODE = '42501';
  END IF;
  IF NOT api.is_workspace_writer(v_record.workspace_id)
     OR NOT internal.can_access_object('record', v_record.id, 'edit') THEN
    RAISE EXCEPTION 'you cannot change this series' USING ERRCODE = '42501';
  END IF;
  IF v_record.kind <> 'experiment' THEN
    RAISE EXCEPTION 'only an experiment can head a series' USING ERRCODE = '22023';
  END IF;
  IF v_record.archived_at IS NOT NULL OR v_record.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'an archived or approved experiment cannot change its series' USING ERRCODE = '22023';
  END IF;
  RETURN v_record;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.series_for_edit(p_record_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.series_for_edit(p_record_id uuid) FROM PUBLIC;
--> statement-breakpoint

-- Make an experiment a series. Adding a first member does this by itself; this
-- is for showing the Series tab before there is one. Safe to repeat.
CREATE FUNCTION api.start_experiment_series(p_record_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_series api.records := internal.series_for_edit(p_record_id);
BEGIN
  IF EXISTS (SELECT 1 FROM api.experiment_series_members WHERE member_record_id = v_series.id) THEN
    RAISE EXCEPTION '% is already part of a series, and a series cannot sit inside another', v_series.identifier
      USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.experiment_series (record_id, workspace_id, created_by_user_id)
  VALUES (v_series.id, v_series.workspace_id, api.current_user_id())
  ON CONFLICT (record_id) DO NOTHING;
  RETURN jsonb_build_object('series_record_id', v_series.id, 'identifier', v_series.identifier);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.start_experiment_series(p_record_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.start_experiment_series(p_record_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.start_experiment_series(p_record_id uuid) TO authenticated;
--> statement-breakpoint

-- Put an experiment in a series, at the end unless a position is given. The
-- member can be in any state; it is not changed. The series is made on the way
-- if it is not one yet.
CREATE FUNCTION api.add_series_member(
    p_series_record_id uuid, p_member_record_id uuid,
    p_position numeric DEFAULT NULL, p_planned_on date DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_series api.records := internal.series_for_edit(p_series_record_id);
  v_member api.records;
  v_position real;
  v_row api.experiment_series_members;
BEGIN
  SELECT * INTO v_member FROM api.records WHERE id = p_member_record_id;
  IF v_member.id IS NULL
     OR v_member.workspace_id IS DISTINCT FROM v_series.workspace_id
     OR v_member.deleted_at IS NOT NULL
     OR NOT internal.can_access_object('record', v_member.id, 'view') THEN
    RAISE EXCEPTION 'experiment not found' USING ERRCODE = '42501';
  END IF;
  IF v_member.kind <> 'experiment' THEN
    RAISE EXCEPTION 'only an experiment can join a series' USING ERRCODE = '22023';
  END IF;
  IF v_member.id = v_series.id THEN
    RAISE EXCEPTION 'an experiment cannot be a member of its own series' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM api.experiment_series_members WHERE member_record_id = v_series.id) THEN
    RAISE EXCEPTION '% is already part of a series, and a series cannot sit inside another', v_series.identifier
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM api.experiment_series WHERE record_id = v_member.id) THEN
    RAISE EXCEPTION '% is a series of its own and cannot join another', v_member.identifier
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM api.experiment_series_members WHERE member_record_id = v_member.id) THEN
    RAISE EXCEPTION '% is already in a series', v_member.identifier USING ERRCODE = '23505';
  END IF;

  INSERT INTO api.experiment_series (record_id, workspace_id, created_by_user_id)
  VALUES (v_series.id, v_series.workspace_id, api.current_user_id())
  ON CONFLICT (record_id) DO NOTHING;

  v_position := coalesce(p_position::real,
    (SELECT coalesce(max(position), 0) + 1 FROM api.experiment_series_members
      WHERE series_record_id = v_series.id));
  INSERT INTO api.experiment_series_members
    (series_record_id, member_record_id, workspace_id, position, planned_on, created_by_user_id)
  VALUES (v_series.id, v_member.id, v_series.workspace_id, v_position, p_planned_on, api.current_user_id())
  RETURNING * INTO v_row;
  RETURN jsonb_build_object(
    'id', v_row.id, 'series_record_id', v_row.series_record_id, 'member_record_id', v_row.member_record_id,
    'position', v_row.position, 'planned_on', v_row.planned_on);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.add_series_member(p_series_record_id uuid, p_member_record_id uuid, p_position numeric, p_planned_on date) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.add_series_member(p_series_record_id uuid, p_member_record_id uuid, p_position numeric, p_planned_on date) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.add_series_member(p_series_record_id uuid, p_member_record_id uuid, p_position numeric, p_planned_on date) TO authenticated;
--> statement-breakpoint

-- Take an experiment out of its series. The experiment is not changed.
CREATE FUNCTION api.remove_series_member(p_member_record_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row api.experiment_series_members;
BEGIN
  SELECT * INTO v_row FROM api.experiment_series_members WHERE member_record_id = p_member_record_id;
  IF v_row.id IS NULL OR v_row.workspace_id IS DISTINCT FROM api.current_workspace_id() THEN
    RAISE EXCEPTION 'that experiment is not in a series' USING ERRCODE = '42501';
  END IF;
  PERFORM internal.series_for_edit(v_row.series_record_id);
  DELETE FROM api.experiment_series_members WHERE id = v_row.id;
  RETURN jsonb_build_object('series_record_id', v_row.series_record_id, 'member_record_id', v_row.member_record_id);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.remove_series_member(p_member_record_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.remove_series_member(p_member_record_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.remove_series_member(p_member_record_id uuid) TO authenticated;
--> statement-breakpoint

-- Change where a member sits in the series.
CREATE FUNCTION api.move_series_member(p_member_record_id uuid, p_position numeric) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row api.experiment_series_members;
BEGIN
  IF p_position IS NULL THEN
    RAISE EXCEPTION 'give a position' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_row FROM api.experiment_series_members WHERE member_record_id = p_member_record_id;
  IF v_row.id IS NULL OR v_row.workspace_id IS DISTINCT FROM api.current_workspace_id() THEN
    RAISE EXCEPTION 'that experiment is not in a series' USING ERRCODE = '42501';
  END IF;
  PERFORM internal.series_for_edit(v_row.series_record_id);
  UPDATE api.experiment_series_members SET position = p_position::real WHERE id = v_row.id RETURNING * INTO v_row;
  RETURN jsonb_build_object('member_record_id', v_row.member_record_id, 'position', v_row.position);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.move_series_member(p_member_record_id uuid, p_position numeric) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.move_series_member(p_member_record_id uuid, p_position numeric) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.move_series_member(p_member_record_id uuid, p_position numeric) TO authenticated;
--> statement-breakpoint

-- Plan the day a member is run, or clear it with null.
CREATE FUNCTION api.set_series_member_day(p_member_record_id uuid, p_planned_on date) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row api.experiment_series_members;
BEGIN
  SELECT * INTO v_row FROM api.experiment_series_members WHERE member_record_id = p_member_record_id;
  IF v_row.id IS NULL OR v_row.workspace_id IS DISTINCT FROM api.current_workspace_id() THEN
    RAISE EXCEPTION 'that experiment is not in a series' USING ERRCODE = '42501';
  END IF;
  PERFORM internal.series_for_edit(v_row.series_record_id);
  UPDATE api.experiment_series_members SET planned_on = p_planned_on WHERE id = v_row.id RETURNING * INTO v_row;
  RETURN jsonb_build_object('member_record_id', v_row.member_record_id, 'planned_on', v_row.planned_on);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_series_member_day(p_member_record_id uuid, p_planned_on date) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_series_member_day(p_member_record_id uuid, p_planned_on date) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_series_member_day(p_member_record_id uuid, p_planned_on date) TO authenticated;
--> statement-breakpoint

-- Stop treating an experiment as a series. Its members are left as they are.
CREATE FUNCTION api.dissolve_experiment_series(p_record_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_series api.records := internal.series_for_edit(p_record_id);
  v_count integer;
BEGIN
  SELECT count(*)::integer INTO v_count FROM api.experiment_series_members WHERE series_record_id = v_series.id;
  DELETE FROM api.experiment_series WHERE record_id = v_series.id;
  RETURN jsonb_build_object('series_record_id', v_series.id, 'members_released', v_count);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.dissolve_experiment_series(p_record_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.dissolve_experiment_series(p_record_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.dissolve_experiment_series(p_record_id uuid) TO authenticated;
--> statement-breakpoint

-- The members of a series in order, as the caller may see them: an experiment
-- the caller cannot read is left out. Steps are counted from the notebook.
CREATE FUNCTION api.series_members(p_series_record_id uuid)
  RETURNS TABLE (
    member_record_id uuid, member_number integer, "position" real, identifier text, title text, status text,
    owner_user_id text, reviewer_user_id text, assignee_user_id text,
    planned_on date, planned_end date, day_offset integer,
    locked_at timestamptz, steps_total integer, steps_done integer, sample_count integer)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  WITH visible AS (
    SELECT m.member_record_id, m.position, m.planned_on, r.identifier, r.title, r.status,
           r.created_by_user_id, r.reviewer_user_id, r.assignee_user_id, r.planned_end, r.locked_at
      FROM api.experiment_series_members m
      JOIN api.records r ON r.id = m.member_record_id AND r.deleted_at IS NULL
     WHERE m.series_record_id = p_series_record_id
  ), start AS (
    SELECT min(planned_on) AS day FROM visible
  )
  SELECT v.member_record_id,
         (row_number() OVER (ORDER BY v.position, v.identifier))::integer,
         v.position,
         v.identifier, v.title, v.status, v.created_by_user_id, v.reviewer_user_id, v.assignee_user_id,
         v.planned_on, v.planned_end,
         CASE WHEN v.planned_on IS NOT NULL THEN (v.planned_on - s.day) END,
         v.locked_at,
         (SELECT count(*)::integer FROM api.blocks b
           WHERE b.record_id = v.member_record_id AND b.type = 'procedure_step'),
         (SELECT count(*)::integer FROM api.blocks b
           WHERE b.record_id = v.member_record_id AND b.type = 'procedure_step'
             AND coalesce(b.payload->>'completed', 'false') = 'true'),
         (SELECT count(DISTINCT l.target_identifier)::integer FROM api.record_links l
           WHERE l.source_record_id = v.member_record_id AND l.link_type = 'sample')
    FROM visible v CROSS JOIN start s
   ORDER BY v.position, v.identifier;
$$;
--> statement-breakpoint
ALTER FUNCTION api.series_members(p_series_record_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.series_members(p_series_record_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.series_members(p_series_record_id uuid) TO authenticated;
--> statement-breakpoint

-- What the series adds up to: how many members there are and how many are
-- approved, the next one due (not one already in review), and the samples across all of them.
CREATE FUNCTION api.series_rollup(p_series_record_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  WITH m AS (
    SELECT * FROM api.series_members(p_series_record_id)
  ), nxt AS (
    SELECT member_record_id, identifier, title, coalesce(planned_on, planned_end) AS due_on
      FROM m
     WHERE status NOT IN ('approved', 'in_review', 'rejected', 'archived', 'cancelled')
     ORDER BY member_number
     LIMIT 1
  )
  SELECT jsonb_build_object(
    'series_record_id', p_series_record_id,
    'total', (SELECT count(*) FROM m),
    'approved', (SELECT count(*) FROM m WHERE status = 'approved'),
    'in_review', (SELECT count(*) FROM m WHERE status = 'in_review'),
    'in_progress', (SELECT count(*) FROM m WHERE status = 'in_progress'),
    'samples', (SELECT count(DISTINCT l.target_identifier)
                  FROM api.record_links l
                 WHERE l.link_type = 'sample'
                   AND l.source_record_id IN (SELECT member_record_id FROM m)),
    'first_day', (SELECT min(planned_on) FROM m),
    'last_day', (SELECT max(coalesce(planned_on, planned_end)) FROM m),
    'next', (SELECT jsonb_build_object('record_id', member_record_id, 'identifier', identifier,
                                       'title', title, 'due_on', due_on) FROM nxt));
$$;
--> statement-breakpoint
ALTER FUNCTION api.series_rollup(p_series_record_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.series_rollup(p_series_record_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.series_rollup(p_series_record_id uuid) TO authenticated;
--> statement-breakpoint

-- The series an experiment is in, where it sits and its neighbours: what the
-- bar on a member reads, "3 of 5 in EXP-0142". No row when it is in none, or
-- when the series is out of the caller's sight.
CREATE FUNCTION api.record_series(p_record_id uuid)
  RETURNS TABLE (
    series_record_id uuid, series_identifier text, series_title text,
    member_number integer, member_total integer,
    previous_record_id uuid, previous_identifier text, previous_title text,
    next_record_id uuid, next_identifier text, next_title text)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  WITH mine AS (
    SELECT m.series_record_id FROM api.experiment_series_members m WHERE m.member_record_id = p_record_id
  ), ordered AS (
    SELECT s.member_record_id, s.member_number, s.identifier, s.title,
           (SELECT count(*) FROM api.series_members(mine.series_record_id))::integer AS total,
           mine.series_record_id
      FROM mine CROSS JOIN LATERAL api.series_members(mine.series_record_id) s
  )
  SELECT o.series_record_id, sr.identifier, sr.title, o.member_number, o.total,
         p.member_record_id, p.identifier, p.title,
         n.member_record_id, n.identifier, n.title
    FROM ordered o
    JOIN api.records sr ON sr.id = o.series_record_id AND sr.deleted_at IS NULL
    LEFT JOIN ordered p ON p.member_number = o.member_number - 1
    LEFT JOIN ordered n ON n.member_number = o.member_number + 1
   WHERE o.member_record_id = p_record_id;
$$;
--> statement-breakpoint
ALTER FUNCTION api.record_series(p_record_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.record_series(p_record_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.record_series(p_record_id uuid) TO authenticated;
--> statement-breakpoint

-- Pipelines may be triggered by members joining and leaving.
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('api.normalize_pipeline_event_type(text)'::regprocedure) INTO v_def;
  IF position('''step.completed'', ''step.reopened'', ''step.result_added'',' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for api.normalize_pipeline_event_type';
  END IF;
  v_def := replace(v_def, '''step.completed'', ''step.reopened'', ''step.result_added'',',
    '''step.completed'', ''step.reopened'', ''step.result_added'', ''experiment.series_member_added'', ''experiment.series_member_removed'',');
  EXECUTE v_def;
END $$;
--> statement-breakpoint

-- A pipeline can add an experiment to a series and take it out again.
DO $$
DECLARE
  v_def text;
  v_added text := $added$,{"operation":"add_series_member","rpc":"add_series_member","label":"Add an experiment to a series","description":"Put an experiment in a series, at the end unless a position is given. The experiment itself is not changed.","arguments":[{"name":"p_series_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_member_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_position","type":"numeric","required":false,"nullable":true},{"name":"p_planned_on","type":"date","required":false,"nullable":true}]},{"operation":"remove_series_member","rpc":"remove_series_member","label":"Take an experiment out of its series","description":"Remove an experiment from the series it is in. The experiment itself is not changed.","arguments":[{"name":"p_member_record_id","type":"uuid","required":true,"nullable":false}]}]$added$;
BEGIN
  SELECT pg_get_functiondef('internal.pipeline_action_errors(jsonb)'::regprocedure) INTO v_def;
  IF position(']$catalogue$::jsonb' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for internal.pipeline_action_errors';
  END IF;
  v_def := replace(v_def, ']$catalogue$::jsonb', v_added || '$catalogue$::jsonb');
  EXECUTE v_def;
END $$;
