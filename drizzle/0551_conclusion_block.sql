-- A conclusion block: what the experiment found, its verdict and its basis.
--
-- Only the type vocabulary changes. api.validate_scientific_block returns early
-- for types it does not know, so the payload ({ text, verdict, basis }) is
-- validated at the application boundary (src/lib/blocks/index.ts), exactly like
-- callout and metric.
ALTER TABLE api.blocks DROP CONSTRAINT chk_blocks_type;
--> statement-breakpoint
ALTER TABLE api.blocks ADD CONSTRAINT chk_blocks_type
  CHECK (type IN (
    'rich_text', 'checklist', 'linked_record', 'callout', 'table', 'sheet',
    'chart', 'analysis', 'plate_map', 'file', 'metric', 'procedure_step',
    'protocol_reference', 'materials', 'pipeline_output', 'signature_request',
    'corrective_actions', 'conclusion'
  ));
