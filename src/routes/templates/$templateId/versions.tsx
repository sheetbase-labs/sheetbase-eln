import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { Notice } from '#/components/ui/alert'
import { Muted } from '#/components/ui/layout'
import { TableBox } from '#/components/ui/table'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import { countTemplateUse } from '#/lib/notebook-template-usage'
import {
  publishedTemplateVersion,
  useSheetDefinitions,
  useTemplateApprovals,
  useTemplateUsers,
  useTemplateVersions,
} from '#/components/templates/templates-data'
import type { NotebookTemplateVersion } from '#/lib/notebook-template-data'
import { useUserNames } from '#/lib/user-names'
import { t } from '#/copy'

import { GovernanceDialog } from './-governance-dialog'
import { versionColumns } from './-versions-columns'
import {
  buildChangeGroups,
  buildChangeText,
  buildRecordsByVersion,
  versionsSearch,
} from './-versions-data'
import type { StalePublish } from './-versions-data'
import { VersionInspector } from './-versions-inspector'

/**
 * UI port (roadmap-4/ui-app3): the Versions tab. Publish and Retire run the
 * CORE-06 RPCs, so the revision checks, the reason, the retire e-signature
 * (the caller must be signature-certified) and the unsigned-records block all
 * stay server-side. R5-CONFIG-04 adds the per-version change set read from the
 * stored definitions, the signature list, and the stale-publish refusal. With
 * `?state=denied` the screen is view-only.
 */
export const Route = createFileRoute('/templates/$templateId/versions')({
  validateSearch: (search) => versionsSearch.parse(search),
  component: TemplateVersions,
})

function TemplateVersions() {
  const { templateId } = Route.useParams()
  const search = Route.useSearch()
  const denied = search.state === 'denied'
  const navigate = Route.useNavigate()
  const queryClient = useQueryClient()
  const versions = useTemplateVersions(templateId)
  const rows = [...(versions.data ?? [])].sort((a, b) => b.version - a.version)
  const current = publishedTemplateVersion(rows)
  const users = useTemplateUsers(rows.map((v) => v.id))
  const approvals = useTemplateApprovals(rows.map((v) => v.id))
  const sheets = useSheetDefinitions(rows)

  const names = useUserNames(
    [
      ...rows.flatMap((v) => [
        v.publishedByUserId,
        v.signedByUserId,
        v.updatedByUserId,
      ]),
      ...[...approvals.values()].flatMap((list) =>
        list.flatMap((r) => r.approved_by_user_ids),
      ),
    ].filter((id): id is string => Boolean(id)),
  )

  const [dialog, setDialog] = useState<{
    kind: 'publish' | 'retire'
    version: NotebookTemplateVersion
  } | null>(null)

  const [stalePublish, setStalePublish] = useState<StalePublish | null>(null)

  const selected = rows.find((v) => v.id === search.v) ?? rows.at(0)
  const compareVersion = rows.find((v) => v.id === search.compare)

  const recordsByVersion = useMemo(
    () => buildRecordsByVersion(users.data ?? []),
    [users.data],
  )

  const changeGroups = useMemo(
    () =>
      buildChangeGroups({
        rows,
        selected,
        compareVersion,
        versionsById: sheets.versionsById,
      }),
    [rows, selected, compareVersion, sheets.versionsById],
  )

  const changeText = useMemo(
    () => buildChangeText({ rows, versionsById: sheets.versionsById }),
    [rows, sheets.versionsById],
  )

  const selectedCounts = useMemo(
    () =>
      countTemplateUse(
        (users.data ?? []).filter(
          (r) => r.source_notebook_template_version_id === selected?.id,
        ),
      ),
    [users.data, selected?.id],
  )

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['ui-port', 'templates'] })

  const reload = () => {
    setStalePublish(null)
    setDialog(null)
    void versions.refetch()
  }

  if (!rows.length || !selected) {
    return (
      <div className="px-4 py-4 md:px-6">
        <EmptyState
          icon="template"
          title={t('library.templates.versions.noVersionsYet')}
          description={t('library.templates.versions.aTemplateNeedsAVersion')}
        />
      </div>
    )
  }

  const firstChange = changeGroups.at(0)
  const staleSelected = stalePublish?.versionId === selected.id

  return (
    <div className="flex min-w-0 flex-1">
      <div className="min-w-0 flex-1 overflow-auto px-4 py-4 md:px-6">
        {denied ? (
          <Notice tone="info" className="mb-3" icon="lock">
            {t('library.templates.versions.viewOnlyOnlyTemplateOwners')}
          </Notice>
        ) : null}
        {stalePublish ? (
          <Notice
            tone="warn"
            className="mb-3"
            icon="warn"
            action={
              <Button size="sm" onClick={reload}>
                {t('library.templates.versions.reload')}
              </Button>
            }
          >
            {t('library.templates.versions.draftVChangedSinceYou', {
              version: stalePublish.version,
              attemptedRevision: stalePublish.attemptedRevision,
            })}
          </Notice>
        ) : null}
        {compareVersion ? (
          <Notice
            tone="info"
            className="mb-3"
            action={
              <Button
                size="sm"
                onClick={() =>
                  void navigate({
                    to: '/templates/$templateId/versions',
                    params: { templateId },
                    search: { v: search.v },
                    replace: true,
                  })
                }
              >
                {t('common.actions.clear')}
              </Button>
            }
          >
            {t('library.templates.versions.comparingVVTheChange', {
              version: compareVersion.version,
              other: selected.version,
            })}
          </Notice>
        ) : null}
        <TableBox>
          <RegistryGrid
            label={t('library.templates.versions.templateVersions')}
            rows={rows}
            columns={versionColumns(
              names.userLabel,
              recordsByVersion,
              current?.id,
              approvals,
              changeText,
            )}
            getRowId={(version) => version.id}
            rowSelection={{ [selected.id]: true }}
            onRowClick={(version) =>
              void navigate({
                to: '/templates/$templateId/versions',
                params: { templateId },
                search: (s) => ({ ...s, v: version.id }),
                replace: true,
              })
            }
            selectable={false}
          />
        </TableBox>
        <Muted className="mt-3">
          {t(
            'library.templates.versions.publishingKeepsEarlierVersionsReadable',
          )}
        </Muted>
      </div>

      <VersionInspector
        templateId={templateId}
        selected={selected}
        currentId={current?.id}
        rows={rows}
        selectedCounts={selectedCounts}
        compareVersion={compareVersion}
        firstChange={firstChange}
        changeGroups={changeGroups}
        denied={denied}
        staleSelected={staleSelected}
        compare={search.compare}
        userLabel={names.userLabel}
        onPublish={() => setDialog({ kind: 'publish', version: selected })}
        onRetire={() => setDialog({ kind: 'retire', version: selected })}
        onCompare={(versionId) =>
          void navigate({
            to: '/templates/$templateId/versions',
            params: { templateId },
            search: (s) => ({ ...s, compare: versionId }),
            replace: true,
          })
        }
      />

      {dialog ? (
        <GovernanceDialog
          kind={dialog.kind}
          version={dialog.version}
          onClose={() => setDialog(null)}
          onDone={() => {
            void invalidate()
            setDialog(null)
          }}
          onStale={(version) => {
            setDialog(null)
            setStalePublish({
              versionId: version.id,
              version: version.version,
              attemptedRevision: version.revision,
            })
          }}
        />
      ) : null}
    </div>
  )
}
