-- R5-NOTE-02: the sign-and-attach block kinds.
--
-- The notebook carries a signature-request declaration and a corrective-actions
-- (CAPA) list alongside the existing block types. Both are ordinary
-- api.blocks rows; only the type vocabulary changes.
--
-- api.validate_scientific_block early-returns types it does not know, so these
-- payloads are validated at the application boundary (src/lib/blocks/index.ts
-- via src/lib/notebook-action-blocks.ts) exactly like rich_text, checklist,
-- sheet and metric already are.
-- ---------------------------------------------------------------------------
ALTER TABLE api.blocks DROP CONSTRAINT chk_blocks_type;
--> statement-breakpoint
ALTER TABLE api.blocks ADD CONSTRAINT chk_blocks_type
  CHECK (type IN (
    'rich_text', 'checklist', 'linked_record', 'callout', 'table', 'sheet',
    'chart', 'analysis', 'plate_map', 'file', 'metric', 'procedure_step',
    'protocol_reference', 'materials', 'pipeline_output', 'signature_request',
    'corrective_actions'
  ));
