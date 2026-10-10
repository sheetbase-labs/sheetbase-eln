-- UI port — the reagent destination is now /materials.
--
-- api.search's deep_link is generated in SQL; rewrite the reagent branch so the
-- canonical destination matches the renamed route.

DO $mig$
DECLARE
  def text;
BEGIN
  def := pg_get_functiondef('api.search(text,uuid,text,text,text,timestamptz,timestamptz,integer,integer,text)'::regprocedure);
  def := replace(def, '''/reagents?selected=''', '''/materials?selected=''');
  EXECUTE def;
END
$mig$;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
