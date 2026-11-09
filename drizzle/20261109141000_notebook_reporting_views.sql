-- Fixed reporting views for stewards over notebook work: comments, files and
-- their versions, protocol versions, training, trained records and deviations,
-- and approval requests with their decisions. Declared with the shared
-- registry, so each workspace gets its own copy owned by reporting_owner.
--
-- A file's storage key is left out: it is how the bytes are found, not
-- something to report on.
SELECT internal.register_reporting_view('comments', 'comments', 'Comments',
  'Comment threads on notebooks, sheets and blocks: who wrote what, and whether the thread is open or resolved.',
  'comments',
  ARRAY['id','record_id','sheet_instance_id','root_id','parent_id','target_kind','body','state','author_user_id','resolved_at','resolved_by_user_id','created_at','updated_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('files', 'files', 'Files',
  'Every file and every version of it, with its status, size, checksum and the version it replaced.',
  'file_objects',
  ARRAY['id','record_id','display_name','media_type','byte_size','checksum','checksum_algorithm','status','status_reason','version','previous_version_id','retention_until','quarantined_at','deleted_at','created_by_user_id','created_at','updated_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('protocol_versions', 'protocol_versions', 'Protocol versions',
  'Each version of each protocol: its status, what changed and when it takes effect or is due for review.',
  'protocol_versions',
  ARRAY['id','protocol_record_id','version','status','change_summary','reason','effective_at','review_due_at','created_by_user_id','created_at','updated_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('protocol_training', 'protocol_training', 'Protocol training',
  'Who has been given which protocol to train on, and by when.',
  'protocol_training',
  ARRAY['id','protocol_record_id','user_id','due_at','notes','created_by_user_id','created_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('protocol_acknowledgements', 'protocol_acknowledgements', 'Protocol acknowledgements',
  'Who has been recorded as trained on which protocol version, and by whom.',
  'protocol_acknowledgements',
  ARRAY['id','protocol_version_id','user_id','acknowledged_at','recorded_by_user_id','notes']);
--> statement-breakpoint
SELECT internal.register_reporting_view('protocol_deviations', 'protocol_deviations', 'Protocol deviations',
  'Where an experiment step differs from the protocol it came from, with the reason given.',
  'protocol_deviations',
  ARRAY['id','record_id','block_id','source_step_block_id','protocol_version_id','frozen_text','recorded_text','reason','reason_by_user_id','reason_at','created_by_user_id','created_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('approval_requests', 'approval_requests', 'Approval requests',
  'Requests for approval of a notebook, protocol or other object, and how each ended.',
  'approval_requests',
  ARRAY['id','object_kind','object_id','object_revision','required_approver_roles','required_approvals','require_independence','state','reason','decision_reason','submitted_by_user_id','submitted_at','decided_by_user_id','decided_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('approval_decisions', 'approval_decisions', 'Approval decisions',
  'Each approver''s decision on an approval request.',
  'approval_request_decisions',
  ARRAY['id','request_id','user_id','role','decision','reason','created_at']);
