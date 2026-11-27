-- The material model was named "Reagent" in the model list and reporting while
-- every screen says "Material". The model side now says what the app says.
UPDATE api.model_kinds SET label = 'Material' WHERE key = 'material';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.reporting_builtin_models()
    RETURNS TABLE(model_key text, view_name text, host text, record_kind text, name text)
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  VALUES
    ('experiment',        'experiments',        'records',    'experiment',        'Experiment'),
    ('sample',            'samples',            'records',    'sample',            'Sample'),
    ('material',          'materials',          'records',    'material',          'Material'),
    ('protocol_template', 'protocol_templates', 'records',    'protocol_template', 'Protocol'),
    ('study',             'studies',            'records',    'study',             'Study'),
    ('notebook_template', 'notebook_templates', 'records',    'notebook_template', 'Notebook template'),
    ('file',              'files',              'records',    'file',              'File'),
    ('report',            'reports',            'records',    'report',            'Report'),
    ('project',           'projects',           'project',    NULL,                'Project'),
    ('instrument',        'instruments',        'instrument', NULL,                'Instrument')
$$;
