-- CORE-06.5: absent Template parameter inputs skip placement mapping so the
-- pinned Sheet Definition resolver applies its own optional/default/required
-- policy instead of raising SB091 during mapping.

CREATE OR REPLACE FUNCTION internal.template_parameter_inputs_for_placement(
  p_placement jsonb,
  p_template_inputs jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  mapping jsonb;
  input jsonb;
  mapped jsonb := '[]'::jsonb;
  found jsonb;
BEGIN
  FOR mapping IN SELECT value FROM jsonb_array_elements(coalesce(p_placement->'parameterMappings','[]'::jsonb)) LOOP
    found := NULL;
    SELECT value INTO found
      FROM jsonb_array_elements(coalesce(p_template_inputs,'[]'::jsonb)) value
      WHERE value->>'parameterId' = mapping->>'templateParameterId';
    IF found IS NULL THEN
      CONTINUE;
    END IF;
    input := found || jsonb_build_object('parameterId', mapping->>'definitionParameterId');
    mapped := mapped || jsonb_build_array(input);
  END LOOP;
  RETURN mapped;
END
$$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
