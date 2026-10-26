-- An analysis can carry more than one chart on the same source. The first chart
-- stays in `spec`, so everything that reads a view's spec keeps working; each
-- further chart is a full ChartSpec in this ordered list.
ALTER TABLE api.analysis_views
  ADD COLUMN extra_charts jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE api.analysis_views
  ADD CONSTRAINT chk_analysis_views_extra_charts
  CHECK (jsonb_typeof(extra_charts) = 'array' AND jsonb_array_length(extra_charts) <= 7);
