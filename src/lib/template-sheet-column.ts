/**
 * Adding a column to the sheet in a draft template, as the three schema writes
 * it takes. A template can only point at a published version of a sheet, so the
 * column goes into a new version of the sheet definition, that version is
 * published, and the section of the draft is pointed at it. The screen's
 * "Add column" and the assistant's card both run this, as the person.
 */
import type { DataClient } from './data-client'
import {
  retargetNotebookTemplateSheetPlacement,
  notebookTemplateDataClient,
} from './notebook-template-data'
import {
  createSheetDefinitionVersion,
  publishSheetDefinitionVersion,
} from './sheet-definition-data'
import type { SheetDefinitionConfiguration } from './sheet-definition'

export interface TemplateSheetColumnTarget {
  definitionId: string
  /** The definition's `revision` as last read. */
  definitionRevision: number
  templateVersionId: string
  /** The draft template version's `revision` as last read. */
  templateRevision: number
  placementId: string
}

export async function addColumnToTemplateSheet(
  target: TemplateSheetColumnTarget,
  /** The pinned layout with the new column already in it. */
  configuration: SheetDefinitionConfiguration,
  client: DataClient = notebookTemplateDataClient,
): Promise<void> {
  const draft = await createSheetDefinitionVersion(
    target.definitionId,
    target.definitionRevision,
    configuration,
    client,
  )

  const published = await publishSheetDefinitionVersion(
    draft.id,
    draft.revision,
    client,
  )

  await retargetNotebookTemplateSheetPlacement(
    {
      versionId: target.templateVersionId,
      expectedRevision: target.templateRevision,
      placementId: target.placementId,
      targetDefinitionVersionId: published.id,
    },
    client,
  )
}
