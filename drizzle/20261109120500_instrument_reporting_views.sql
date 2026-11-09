-- Steward SQL views for instruments, bookings, runs, imports and connectors,
-- declared through the shared registry (internal.register_reporting_view). Each
-- lists only the columns named, so a connector's settings, which can hold a
-- secret, are not shown.
SELECT internal.register_reporting_view('instruments', 'instruments', 'Instruments',
  'The lab''s instruments: type, model, where each is, who owns it and whether it is retired or out of service.',
  'instruments',
  ARRAY['id','display_id','name','instrument_type','model','serial_number','vendor','location','owner_id','connection_status','intake_method','retired_at','out_of_service_at','out_of_service_reason','expected_back_on','created_at','updated_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('instrument_calibrations', 'instrument_calibrations', 'Instrument calibrations',
  'When each instrument was calibrated and when the next calibration is due.',
  'instrument_calibrations',
  ARRAY['id','instrument_id','performed_at','due_at','performed_by_user_id','notes','created_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('instrument_qualifications', 'instrument_qualifications', 'Instrument qualifications',
  'Who is qualified on which instrument, and until when.',
  'instrument_qualifications',
  ARRAY['id','instrument_id','user_id','valid_until','granted_by_user_id','created_at','updated_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('bookings', 'bookings', 'Bookings',
  'Bookings of instruments and other resources: when, for which project or experiment, and whether cancelled.',
  'calendar_bookings',
  ARRAY['id','display_id','resource_id','project_id','title','status','all_day','starts_at','ends_at','timezone','location','linked_experiment_record_id','linked_experiment_identifier','cancelled_at','created_by_user_id','created_at','updated_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('booking_participants', 'booking_participants', 'Booking participants',
  'Who takes part in each booking.',
  'calendar_booking_participants',
  ARRAY['id','booking_id','user_id','display_name','role','created_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('instrument_runs', 'instrument_runs', 'Instrument runs',
  'Runs on instruments: protocol, status, operator and when each started and finished.',
  'instrument_runs',
  ARRAY['id','instrument_id','project_id','name','run_identifier','protocol_name','status','progress_percent','plate_format','started_at','completed_at','operator','error_message','queue_position','tags','created_at','updated_at','created_by_user_id']);
--> statement-breakpoint
SELECT internal.register_reporting_view('instrument_run_links', 'instrument_run_links', 'Instrument run links',
  'The experiments and samples each run is linked to.',
  'instrument_run_links',
  ARRAY['id','run_id','linked_record_id','linked_record_identifier','linked_record_title','link_type','created_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('instrument_qc_checks', 'instrument_qc_checks', 'Instrument quality checks',
  'Quality checks made on each run and what they found.',
  'instrument_qc_checks',
  ARRAY['id','run_id','check_name','check_type','message','checked_at','created_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('dataset_imports', 'dataset_imports', 'Data imports',
  'Imports of instrument or connector data into datasets, and whether each was committed or failed.',
  'dataset_imports',
  ARRAY['id','dataset_id','experiment_record_id','instrument_id','parser_id','parser_version_id','connector_run_id','status','error_detail','created_by_user_id','created_at','updated_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('parsers', 'parsers', 'Parsers',
  'Parsers that read instrument files into rows.',
  'parsers',
  ARRAY['id','instrument_id','key','name','format','created_by_user_id','created_at','updated_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('connectors', 'connectors', 'Connectors',
  'Connectors that bring data in from or send it to other systems. Their settings are not shown.',
  'connectors',
  ARRAY['id','key','name','connector_type','direction','status','parser_id','created_by_user_id','created_at','updated_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('connector_runs', 'connector_runs', 'Connector runs',
  'Each run of a connector, whether it succeeded or failed, and the error.',
  'connector_runs',
  ARRAY['id','connector_id','trigger_kind','status','attempt','retry_of_run_id','error_code','error_message','started_at','finished_at','actor_user_id','created_at']);
