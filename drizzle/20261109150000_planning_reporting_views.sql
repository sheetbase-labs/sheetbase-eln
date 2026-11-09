-- Fixed reporting views for planning and reporting: studies, the planner,
-- reports, plate designs and analysis views. Uses the shared mechanism
-- internal.register_reporting_view. The report's rendered HTML is not listed.
SELECT internal.register_reporting_view('studies', 'studies', 'Studies',
  'Studies with their summary, dates and plan version.',
  'studies',
  ARRAY['record_id','summary','starts_on','ends_on','plan_version','created_at','updated_at','created_by_user_id','updated_by_user_id']);
--> statement-breakpoint
SELECT internal.register_reporting_view('study_workstreams', 'study_workstreams', 'Study workstreams',
  'The workstreams of each study plan.',
  'study_workstreams',
  ARRAY['id','study_record_id','project_id','name','color','position','status','created_at','updated_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('study_tasks', 'study_tasks', 'Study tasks',
  'Planner tasks: status, dates, priority, linked experiment and protocol, and whether a client can see them.',
  'study_tasks',
  ARRAY['id','study_record_id','workstream_id','project_id','title','description','task_type','status','priority','starts_at','ends_at','due_at','progress_percent','linked_experiment_record_id','linked_protocol_record_id','approval_required','approval_status','tags','client_visible','created_at','updated_at','created_by_user_id','updated_by_user_id']);
--> statement-breakpoint
SELECT internal.register_reporting_view('study_deliverables', 'study_deliverables', 'Study deliverables',
  'What each planner task has to deliver, and the record that evidences it.',
  'study_deliverables',
  ARRAY['id','task_id','name','description','status','due_at','linked_record_id','position','created_at','updated_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('study_task_dependencies', 'study_task_dependencies', 'Task dependencies',
  'Which planner task waits on which.',
  'study_task_dependencies',
  ARRAY['id','predecessor_id','successor_id','dependency_type','lag_days','is_external','created_at','created_by_user_id']);
--> statement-breakpoint
SELECT internal.register_reporting_view('study_task_assignments', 'study_task_assignments', 'Task assignments',
  'Who is assigned to each planner task.',
  'study_task_assignments',
  ARRAY['id','task_id','user_id','role','effort_percent','created_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('study_plan_snapshots', 'study_plan_snapshots', 'Study plan snapshots',
  'Saved versions of a study plan and why each was taken.',
  'study_plan_snapshots',
  ARRAY['id','study_record_id','plan_version','reason','created_at','created_by_user_id']);
--> statement-breakpoint
SELECT internal.register_reporting_view('reports', 'reports', 'Reports',
  'Report documents and their status and version.',
  'report_definitions',
  ARRAY['id','project_id','record_id','title','subtitle','document_identifier','status','version','last_saved_at','created_at','updated_at','created_by_user_id']);
--> statement-breakpoint
SELECT internal.register_reporting_view('report_generations', 'report_generations', 'Report generations',
  'Each time a report was generated, with its checksum and size. The rendered document itself is not here.',
  'report_generations',
  ARRAY['id','report_id','report_version','output_format','output_checksum','output_size_bytes','actor_user_id','generated_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('plate_designs', 'plate_designs', 'Plate designs',
  'Plate designs and their format and status.',
  'plate_designs',
  ARRAY['id','project_id','name','format','rows','cols','status','created_at','updated_at','created_by_user_id']);
--> statement-breakpoint
SELECT internal.register_reporting_view('plate_layout_templates', 'plate_layout_templates', 'Plate layout templates',
  'Reusable plate layouts.',
  'plate_layout_templates',
  ARRAY['id','name','description','format','rows','cols','status','created_at','updated_at','created_by_user_id']);
--> statement-breakpoint
SELECT internal.register_reporting_view('analysis_views', 'analysis_views', 'Analysis views',
  'Saved analysis views and their version.',
  'analysis_views',
  ARRAY['id','display_id','name','owner_user_id','version','created_at','updated_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('analysis_definitions', 'analysis_definitions', 'Analysis definitions',
  'Saved analysis definitions and their version.',
  'analysis_definitions',
  ARRAY['id','display_id','name','owner_user_id','version','created_at','updated_at']);
