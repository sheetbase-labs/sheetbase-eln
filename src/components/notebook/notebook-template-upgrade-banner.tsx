/**
 * EXP-04.1 — the notebook's template-version banner.
 *
 * A Notebook pinned to a Notebook Template Version keeps that pin until its
 * owner chooses otherwise (REUSE-03). When a newer published version exists,
 * the working surface states which version the notebook is on and offers the
 * per-notebook update view; when the pin is current, or the lineage cannot be
 * resolved, it renders nothing.
 *
 * This banner is informational only — it never previews, applies or writes
 * anything. Adoption stays an explicit choice in
 * `/templates/$templateId/update` (SHEET-04.4).
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import { Banner } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import type { DataClient } from '#/lib/data-client'
import {
  fetchNotebookTemplate,
  fetchNotebookTemplateVersion,
  fetchNotebookTemplateVersions,
  notebookTemplateDataClient,
} from '#/lib/notebook-template-data'
import { notebookTemplateUpgradeAvailability } from '#/lib/reuse-upgrade'

export function NotebookTemplateUpgradeBanner({
  recordId,
  pinnedVersionId,
  client = notebookTemplateDataClient,
}: {
  recordId: string
  /** `records.source_notebook_template_version_id`, null when unpinned. */
  pinnedVersionId: string | null | undefined
  client?: DataClient
}) {
  // Query keys match the inspector's pin label so the pin, template and
  // lineage reads are shared rather than fetched twice.
  const version = useQuery({
    queryKey: ['notebook-template-version', pinnedVersionId],
    enabled: Boolean(pinnedVersionId),
    queryFn: () => fetchNotebookTemplateVersion(pinnedVersionId!, client),
  })
  const templateId = version.data?.templateId ?? null
  const template = useQuery({
    queryKey: ['notebook-template', templateId],
    enabled: Boolean(templateId),
    queryFn: () => fetchNotebookTemplate(templateId!, client),
  })
  const versions = useQuery({
    queryKey: ['notebook-template-versions', templateId],
    enabled: Boolean(templateId),
    queryFn: () => fetchNotebookTemplateVersions(templateId!, client),
  })
  // REUSE-03: the stored pin against the published lineage. Silent unless a
  // newer published version exists.
  const availability = notebookTemplateUpgradeAvailability(
    version.data
      ? { id: version.data.id, version: version.data.version }
      : null,
    versions.data ?? [],
  )
  const latest = availability.latestVersion
  if (
    availability.status !== 'upgrade-available' ||
    !latest ||
    !version.data ||
    !templateId
  ) {
    return null
  }
  const name = template.data?.name ?? 'Notebook template'
  return (
    <Banner
      action={
        <Button
          size="sm"
          variant="secondary"
          data-print-hide
          nativeButton={false}
          render={
            <Link
              to="/templates/$templateId/update"
              params={{ templateId }}
              search={{ record: recordId }}
            />
          }
        >
          Review v{latest.version}
        </Button>
      }
    >
      Template <b className="font-semibold">{name}</b> has a new version (v
      {latest.version}). This notebook stays on v{version.data.version} until
      you choose.
    </Banner>
  )
}
