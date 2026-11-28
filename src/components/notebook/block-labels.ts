import { t } from '#/copy'

/** What a kind of block is called, such as "Procedure step" or "Plate map". */
export function blockTypeLabel(type: string): string {
  const labels = new Map(
    Object.entries({
      rich_text: t('notebook.notebookDocument.text'),
      checklist: t('notebook.notebookDocument.list'),
      callout: t('notebook.notebookDocument.note'),
      linked_record: t('notebook.notebookDocument.link'),
      table: t('notebook.notebookDocument.table'),
      sheet: t('notebook.notebookDocument.sheet'),
      dataset_import: t('notebook.notebookDocument.importData'),
      chart: t('notebook.notebookDocument.chart'),
      plate_map: t('notebook.notebookDocument.plateMap'),
      plate_run: t('features.plateRuns.block.label'),
      file: t('notebook.notebookDocument.file'),
      metric: t('notebook.notebookDocument.metric'),
      procedure_step: t('notebook.notebookDocument.procedureStep'),
      protocol_reference: t('notebook.notebookDocument.protocol'),
      materials: t('notebook.notebookDocument.materials'),
      analysis: t('notebook.notebookDocument.analysis'),
      pipeline_output: t('notebook.notebookDocument.pipelineOutput'),
      code_cell: t('notebook.notebookDocument.codeCell'),
      signature_request: t('notebook.notebookDocument.signatureRequest'),
      corrective_actions: t('notebook.notebookDocument.correctiveActions'),
      conclusion: t('notebook.notebookDocument.conclusion'),
    }),
  )

  return labels.get(type) ?? type
}
