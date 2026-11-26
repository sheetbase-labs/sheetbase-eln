import type { DataClient } from '#/lib/data-client'
import {
  applyNotebookTemplateUpgrade,
  instantiateNotebookTemplateVersion,
  previewNotebookTemplateUpgrade,
} from '#/lib/notebook-template-data'

import type { FeatureActionResult } from '../define'
import type { TemplateVersionsAction } from './cards'

/** Runs the card in the person's own session, so their access applies. */
export async function runTemplateVersionsAction(
  client: DataClient,
  action: TemplateVersionsAction,
): Promise<FeatureActionResult | undefined> {
  switch (action.kind) {
    case 'template.use': {
      const made = await instantiateNotebookTemplateVersion(
        {
          versionId: action.versionId,
          targetProjectId: action.projectId,
          title: action.title ?? undefined,
          idempotencyKey: action.idempotencyKey,
        },
        client,
      )

      return { openHref: `/records/${made.record.id}` }
    }

    case 'template.upgrade_notebook': {
      const preview = await previewNotebookTemplateUpgrade(
        action.recordId,
        action.targetVersionId,
        client,
      )

      if (preview.conflicts.length > 0) {
        throw new Error(
          'This update needs a decision on a sheet. Open the notebook to choose.',
        )
      }

      const rows = await client.list<{ structure_version: number }>(
        'records',
        `?id=eq.${encodeURIComponent(action.recordId)}&select=structure_version&limit=1`,
      )

      const version = rows.at(0)?.structure_version

      if (version === undefined)
        throw new Error('This notebook is not available.')

      await applyNotebookTemplateUpgrade(
        {
          recordId: action.recordId,
          expectedStructureVersion: Number(version),
          targetVersionId: action.targetVersionId,
          decisions: [],
        },
        client,
      )

      return { openHref: `/records/${action.recordId}` }
    }
  }
}
