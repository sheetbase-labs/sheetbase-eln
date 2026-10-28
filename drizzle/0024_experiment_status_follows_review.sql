-- An experiment's status never followed its review. Submitting left it at
-- In progress, approving left it there too, and only the seeded rows said In
-- review or Approved, so the Experiments tabs, the Home counts and the page
-- header disagreed with the review the person had just been through.
--
-- The review submission is where those facts are recorded, so the experiment
-- status now follows it: a new submission puts the experiment In review, an
-- approval makes it Approved, a request for changes marks it Returned, and a
-- withdrawn or rejected review hands it back as In progress. Only experiments
-- that have started are moved, and a locked record is left as signed.

CREATE FUNCTION internal.trg_experiment_status_follows_review() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_next text;
BEGIN
  v_next := CASE NEW.state
    WHEN 'submitted' THEN 'in_review'
    WHEN 'approved' THEN 'approved'
    WHEN 'returned' THEN 'returned'
    WHEN 'withdrawn' THEN 'in_progress'
    WHEN 'rejected' THEN 'in_progress'
  END;
  IF v_next IS NULL THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.state IS NOT DISTINCT FROM OLD.state THEN
    RETURN NULL;
  END IF;
  UPDATE api.records
     SET status = v_next,
         metadata_version = metadata_version + 1,
         updated_at = now()
   WHERE id = NEW.record_id
     AND kind = 'experiment'
     AND locked_at IS NULL
     AND status IN ('in_progress', 'in_review', 'returned', 'approved')
     AND status IS DISTINCT FROM v_next;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_experiment_status_follows_review() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER experiment_status_follows_review
  AFTER INSERT OR UPDATE OF state ON api.review_submissions
  FOR EACH ROW EXECUTE FUNCTION internal.trg_experiment_status_follows_review();
