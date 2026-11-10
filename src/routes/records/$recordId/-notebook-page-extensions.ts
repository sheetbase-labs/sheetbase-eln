/**
 * The notebook page's extension points and the sample extension's panel.
 *
 * EXT-02: enabled-install contributions for this caller. The hooks read the
 * workspace installs through the public client surface and resolve them through
 * the single registry; loading and failure degrade to empty points, never an
 * error surface.
 */
import { useCallback, useState } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'

import { usePluginPoints } from '#/components/extensions/use-plugin-points'
import { useExtensionPoints } from '#/components/extensions/use-extension-points'
import {
  describeExtensionInvocationError,
  invokeExtensionContribution,
} from '#/lib/extensions/registry'
import type { ResolvedExtensionContribution } from '#/lib/extensions/registry'
import {
  formatDate,
  notebookDataClient,
  recordKindLabel,
} from '#/lib/notebook-data'
import type {
  NotebookLink,
  NotebookRecord,
  RecordActivityItem,
  RevisionWire,
} from '#/lib/notebook-data'
import { recordFromRevisionSnapshot } from '#/lib/notebook-experience'
import { t } from '#/copy'

export function useNotebookExtensions({
  workspaceId,
  workspaceRole,
  recordQuery,
  activityQuery,
  linksQuery,
  historicalRevisionId,
  historicalRevisionQuery,
}: {
  workspaceId: string | null
  workspaceRole: string | null
  recordQuery: UseQueryResult<NotebookRecord | null, Error>
  activityQuery: UseQueryResult<RecordActivityItem[], Error>
  linksQuery: UseQueryResult<NotebookLink[], Error>
  historicalRevisionId: string | undefined
  historicalRevisionQuery: UseQueryResult<RevisionWire | null, Error>
}) {
  const extensionPoints = useExtensionPoints(
    notebookDataClient,
    workspaceId,
    workspaceRole,
  )

  const pluginPoints = usePluginPoints()
  const [samplePanelOpen, setSamplePanelOpen] = useState(false)
  const [extensionError, setExtensionError] = useState<string | null>(null)

  // EXT-02 invocation: the server-side assert gates execution (fail-closed);
  // the sample's read-only affordance then opens its data panel. The
  // returned audit fragment has no durable write to stamp here — writers
  // stamp it into their canonical payload channel.
  const runExtensionContribution = (
    contribution: ResolvedExtensionContribution,
  ) => {
    if (!workspaceId) return
    setExtensionError(null)
    void invokeExtensionContribution(
      notebookDataClient,
      workspaceId,
      contribution,
      async () => undefined,
    )
      .then(() => setSamplePanelOpen(true))
      .catch((cause: unknown) =>
        setExtensionError(describeExtensionInvocationError(cause)),
      )
  }

  // EXT-02 sample panel content, bound to the ordinary public contract
  // reads this route already performs (record/activity/links queries).
  // The panel receives only this loader — no data import of its own.
  // Hooks discipline: this callback is registered before every early return
  // below and reads query data with null-safety, so loading → loaded
  // transitions never change the hook count.
  const loadSampleSummary = useCallback(async () => {
    const base = recordQuery.data ?? null

    const summaryRecord =
      base && historicalRevisionId && historicalRevisionQuery.data
        ? recordFromRevisionSnapshot(
            base,
            historicalRevisionQuery.data.metadata_snapshot,
          )
        : base

    const summaryActivity = activityQuery.data ?? []
    const summaryLinks = linksQuery.data ?? []

    return {
      heading: summaryRecord?.title ?? '',
      subheading: summaryRecord
        ? `${recordKindLabel(summaryRecord.kind)} · ${summaryRecord.identifier}`
        : '',
      rows: [
        {
          label: t('notebook.notebookPage.label'),
          value: summaryRecord?.status ?? '',
        },
        {
          label: t('notebook.notebookPage.updatedLabel'),
          value: summaryRecord ? formatDate(summaryRecord.updatedAt) : '',
        },
        {
          label: t('notebook.notebookPage.activityLabel'),
          value: t('notebook.notebookPage.eventCount', {
            count: summaryActivity.length,
          }),
        },
        {
          label: t('notebook.notebookPage.linksLabel'),
          value: t('notebook.notebookPage.linkCount', {
            count: summaryLinks.length,
          }),
        },
      ],
    }
  }, [
    recordQuery.data,
    historicalRevisionQuery.data,
    historicalRevisionId,
    activityQuery.data,
    linksQuery.data,
  ])

  return {
    extensionPoints,
    pluginPoints,
    samplePanelOpen,
    setSamplePanelOpen,
    extensionError,
    runExtensionContribution,
    loadSampleSummary,
  }
}
