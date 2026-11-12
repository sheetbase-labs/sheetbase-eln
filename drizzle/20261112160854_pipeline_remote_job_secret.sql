ALTER TABLE api.pipeline_remote_jobs ADD COLUMN secret_name text;
--> statement-breakpoint
COMMENT ON COLUMN api.pipeline_remote_jobs.secret_name IS 'The name of the connection secret the job was sent with. The value is never stored here.';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.pipeline_remote_step_error(p_config jsonb) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_step jsonb;
  v_job jsonb;
  v_lake jsonb;
  v_table text;
  v_seen text[];
BEGIN
  IF jsonb_typeof(p_config->'steps') IS DISTINCT FROM 'array' THEN
    RETURN NULL;
  END IF;
  FOR v_step IN SELECT value FROM jsonb_array_elements(p_config->'steps') LOOP
    IF jsonb_typeof(v_step) IS DISTINCT FROM 'object' THEN
      CONTINUE;
    END IF;
    IF v_step->>'kind' = 'remote_job' THEN
      v_job := v_step->'remoteJob';
      IF jsonb_typeof(v_job) IS DISTINCT FROM 'object'
        OR jsonb_typeof(v_job->'connection') IS DISTINCT FROM 'string'
        OR jsonb_typeof(v_job->'queue') IS DISTINCT FROM 'string'
        OR jsonb_typeof(v_job->'script') IS DISTINCT FROM 'string'
        OR jsonb_typeof(v_job->'limitMinutes') IS DISTINCT FROM 'number' THEN
        RETURN 'A remote job step needs a connection, a queue, a script and a time limit.';
      END IF;
      IF v_job->>'connection' !~ '^[a-z][a-z0-9-]{0,48}$' THEN
        RETURN 'A remote job step needs the connection it runs on.';
      END IF;
      IF v_job->>'queue' !~ '^[a-z0-9][a-z0-9_.-]{0,62}$' THEN
        RETURN 'A remote job step needs the queue it runs on.';
      END IF;
      IF v_job ? 'secret' AND (
        jsonb_typeof(v_job->'secret') IS DISTINCT FROM 'string'
        OR v_job->>'secret' !~ '^[A-Za-z][A-Za-z0-9_]{0,48}$') THEN
        RETURN 'A remote job secret is named with letters, digits and underscores, such as HPC_SUBMIT_KEY.';
      END IF;
      IF length(btrim(v_job->>'script')) NOT BETWEEN 1 AND 20000 THEN
        RETURN 'A remote job script is 1 to 20000 characters.';
      END IF;
      IF (v_job->>'limitMinutes')::numeric <> trunc((v_job->>'limitMinutes')::numeric)
        OR (v_job->>'limitMinutes')::numeric NOT BETWEEN 1 AND 10080 THEN
        RETURN 'A remote job time limit is a whole number of minutes, from 1 to 10080.';
      END IF;
    ELSIF v_step->>'kind' = 'lakehouse' THEN
      v_lake := v_step->'lake';
      IF jsonb_typeof(v_lake) IS DISTINCT FROM 'object'
        OR jsonb_typeof(v_lake->'tables') IS DISTINCT FROM 'array' THEN
        RETURN 'A lakehouse step needs the open tables it reads.';
      END IF;
      IF jsonb_array_length(v_lake->'tables') NOT BETWEEN 1 AND 10 THEN
        RETURN 'A lakehouse step reads 1 to 10 open tables.';
      END IF;
      v_seen := '{}'::text[];
      FOR v_table IN SELECT value::text FROM jsonb_array_elements(v_lake->'tables') LOOP
        IF v_table !~ '^"[a-z][a-z0-9_]{0,62}"$' THEN
          RETURN 'Open table names are lowercase letters, digits and underscores.';
        END IF;
        IF v_table = ANY(v_seen) THEN
          RETURN 'A lakehouse step names each open table once.';
        END IF;
        v_seen := array_append(v_seen, v_table);
      END LOOP;
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
--> statement-breakpoint
