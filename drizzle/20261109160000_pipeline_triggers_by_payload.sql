-- Nine events that share a change with other events (a robot job moving on, a
-- schedule decided, a QC series back in control, a code cell reproduced) were
-- flagged for pipelines but left out of the trigger list, because the sweep only
-- looked at the entity and operation. The sweep now also tests the payload, so
-- they join the list the database accepts. Twelve more that the picker offered
-- (a record signed, the data contract events, a run converted, a QC violation,
-- a job queued, a schedule proposed, a code cell run) were refused when a
-- trigger was saved; they are added too, with the first workspace settings row.
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('api.normalize_pipeline_event_type(text)'::regprocedure) INTO v_def;
  IF position('''watcher.finding.created''' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for api.normalize_pipeline_event_type';
  END IF;
  v_def := replace(v_def, '''watcher.finding.created''',
    '''watcher.finding.created'', ''instrument.job.staged'', ''instrument.job.started'', ''instrument.job.completed'', ''instrument.job.failed'', ''instrument.job.cancelled'', ''schedule.accepted'', ''schedule.dismissed'', ''qc.back_in_control'', ''code_cell.reproduced'', ''record.signed'', ''contract.created'', ''contract.updated'', ''contract.deleted'', ''contract.check.completed'', ''contract.breached'', ''contract.restored'', ''instrument.run.converted'', ''qc.violation'', ''instrument.job.queued'', ''schedule.proposed'', ''code_cell.run'', ''workspace.settings.created'');
  EXECUTE v_def;
END $$;
