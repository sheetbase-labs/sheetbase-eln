-- No-code step kinds for the Standard editor: filter, join, calculate, check
-- ranges and flag. A no-code step stores the settings a person picked (`form`)
-- and the SQL those settings write (`statement`); the runner runs the
-- statement, so each kind runs as `sql` and the database's step checks (a
-- statement of 1 to 20000 characters) apply to it unchanged.

INSERT INTO internal.pipeline_step_kinds (kind, runs) VALUES
  ('filter', 'sql'),
  ('join', 'sql'),
  ('calculate', 'sql'),
  ('check_ranges', 'sql'),
  ('flag', 'sql')
ON CONFLICT (kind) DO NOTHING;
