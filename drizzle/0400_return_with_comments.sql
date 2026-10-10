-- REV-01.3 — returning a revision and publishing the reviewer's comments is one act.
--
-- The reviewer's comments are private drafts until the return carries them. Publishing
-- them as separate calls would allow a returned review whose comments never arrived, or
-- comments on a review that was never returned. This RPC does both in one transaction:
-- the decision first (so a refused return publishes nothing), then the comments, so the
-- caller either gets a returned review with its comments or nothing at all.
--
-- It deliberately adds no second decision path: it calls the canonical
-- api.request_changes_on_review and the canonical api.create_comment.

CREATE OR REPLACE FUNCTION api.return_revision_with_comments(
  p_submission_id uuid,
  p_note text,
  p_expected_state text,
  p_expected_revision_digest text,
  p_comments jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_revision uuid;
  v_decision jsonb;
  v_comment jsonb;
  v_ids jsonb := '[]'::jsonb;
  v_created jsonb;
BEGIN
  IF p_comments IS NULL OR jsonb_typeof(p_comments) <> 'array' THEN
    RAISE EXCEPTION 'Comments must be an array' USING ERRCODE='22023';
  END IF;

  SELECT revision_id INTO v_revision
    FROM api.review_submissions
   WHERE id = p_submission_id;
  IF v_revision IS NULL THEN
    RAISE EXCEPTION 'Unknown review submission' USING ERRCODE='22023';
  END IF;

  -- The decision first: if the return is refused (stale digest, wrong state, no
  -- review permission), the drafts must not be published.
  v_decision := api.request_changes_on_review(
    p_submission_id,
    p_note,
    coalesce(p_expected_state, 'submitted'),
    p_expected_revision_digest
  );

  FOR v_comment IN SELECT * FROM jsonb_array_elements(p_comments) LOOP
    IF coalesce(v_comment->>'body', '') = '' THEN
      RAISE EXCEPTION 'A draft comment has no body' USING ERRCODE='22023';
    END IF;
    v_created := api.create_comment(
      v_revision,
      v_comment->>'targetKind',
      v_comment->'target',
      v_comment->>'body',
      coalesce(
        (SELECT array_agg(value) FROM jsonb_array_elements_text(v_comment->'mentions')),
        ARRAY[]::text[]
      )
    );
    v_ids := v_ids || to_jsonb(v_created->>'id');
  END LOOP;

  RETURN jsonb_build_object('decision', v_decision, 'commentIds', v_ids);
END $function$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION api.return_revision_with_comments(uuid, text, text, text, jsonb) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.return_revision_with_comments(uuid, text, text, text, jsonb) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
