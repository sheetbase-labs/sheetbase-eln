import { useState } from 'react'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ProtocolDocument } from '#/components/v3/protocols/protocol-document'
import { ProtocolInspector } from '#/components/v3/protocols/protocol-inspector'
import {
  ProtocolVersionsPanel,
  protocolVersionsKey,
} from '#/components/v3/protocols/protocol-versions-panel'
import { ProtocolTrainingRoster } from '#/components/v3/protocols/protocol-training-roster'
import { ProtocolVersionTraining } from '#/components/v3/protocols/protocol-version-training'
import { ObjectLink } from '#/components/v3/ui/object-link'
import { Tabs } from '#/components/v3/ui/tabs'
import { PageHeader, Muted, Section } from '#/components/v3/ui/layout'
import { Status } from '#/components/v3/ui/status'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { FavouriteToggle } from '#/components/favourites/favourite-toggle'
import { Button } from '#/components/v3/ui/button'
import { useRecentViewTracking } from '#/lib/recents'
import { Select } from '#/components/v3/ui/select'
import { toast } from '#/components/v3/ui/sonner'
import { TableBox } from '#/components/v3/ui/table'
import {
  RegistryGrid,
  rightAligned,
} from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import {
  fetchBlocksForRecord,
  fetchRecord,
  fetchLinksForRecord,
  fetchRevision,
  notebookDataClient,
  notebookQueryKeys,
} from '#/lib/notebook-data'

import {
  acknowledgeProtocolVersion,
  fetchProtocolAcknowledgements,
  fetchProtocolAcknowledgeWriter,
  fetchProtocolVersions,
} from '#/lib/controlled-protocols'
import { useUserNames } from '#/lib/user-names'
import { protocolStatus } from '#/components/v3/protocols/protocols-registry-grid'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { t } from '#/copy'
import { formatDate } from '#/lib/format-date'

const tabs = ['document', 'template', 'usedby', 'versions', 'training'] as const
type ProtocolTab = (typeof tabs)[number]

/** UI port (roadmap-4/ui-app3): the protocol detail frame. The controlled
 * document is the record's rich-text blocks; Template, Used by and Versions
 * read the real structure, links and revisions; Training records
 * acknowledgement against the exact frozen version via
 * `acknowledge_protocol_version`. */
export const Route = createFileRoute('/protocols/$protocolId')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { section?: ProtocolTab } => ({
    section:
      search.section === 'template' ||
      search.section === 'usedby' ||
      search.section === 'versions' ||
      search.section === 'document' ||
      search.section === 'training'
        ? search.section
        : undefined,
  }),
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect(signInRedirect(location))
    }
    return { context }
  },
  component: ProtocolPage,
})

function ProtocolPage() {
  const { protocolId } = Route.useParams()
  const { context } = Route.useRouteContext()
  const search = Route.useSearch()
  const tab = search.section ?? 'document'
  const record = useQuery({
    queryKey: notebookQueryKeys.record(protocolId),
    queryFn: () => fetchRecord(notebookDataClient, protocolId),
  })
  const blocks = useQuery({
    queryKey: ['ui-port', 'protocol-blocks', protocolId],
    queryFn: () => fetchBlocksForRecord(notebookDataClient, protocolId),
  })
  const links = useQuery({
    queryKey: ['ui-port', 'protocol-links', protocolId],
    queryFn: () => fetchLinksForRecord(notebookDataClient, protocolId),
  })
  const versions = useQuery({
    queryKey: protocolVersionsKey(protocolId),
    queryFn: () => fetchProtocolVersions(notebookDataClient, protocolId),
  })
  const [pickedVersionId, setPickedVersionId] = useState<string | null>(null)
  const versionRows = versions.data ?? []
  // The document reads the version picked, else the effective one, else the
  // newest frozen one; with no frozen version it falls back to the working text.
  const shownVersion =
    versionRows.find((v) => v.id === pickedVersionId) ??
    versionRows.find((v) => v.status === 'effective') ??
    [...versionRows].sort((a, b) => b.version - a.version).at(0)
  const snapshot = useQuery({
    queryKey: ['ui-port', 'protocol-revision', shownVersion?.id ?? ''],
    queryFn: () => fetchRevision(notebookDataClient, shownVersion?.id ?? ''),
    enabled: Boolean(shownVersion),
  })
  const names = useUserNames([
    ...(record.data ? [record.data.createdByUserId] : []),
  ])
  const p = record.data
  useRecentViewTracking('record', p?.kind === 'protocol_template' ? p.id : null)

  if (!p || p.kind !== 'protocol_template') {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          trail={[
            {
              label: t('library.protocols.detail.protocols'),
              link: { to: '/protocols' },
            },
          ]}
          title={
            record.isLoading
              ? t('library.protocols.detail.loadingProtocol')
              : t('library.protocols.detail.protocolNotFound')
          }
        />
        {record.isLoading ? null : (
          <div className="px-4 py-4 md:px-6">
            <EmptyState
              icon="protocol"
              title={t('library.protocols.detail.thisProtocolIsntAvailableTo')}
              description={t('library.protocols.detail.itMayHaveBeenRemoved')}
              action={
                <Button nativeButton={false} render={<Link to="/protocols" />}>
                  {t('library.protocols.detail.backToProtocols')}
                </Button>
              }
            />
          </div>
        )}
      </div>
    )
  }
  type ProtocolBlock = NonNullable<typeof blocks.data>[number]
  type ProtocolLink = NonNullable<typeof links.data>[number]
  const effectiveVersion = versions.data?.find((v) => v.status === 'effective')
  // A protocol is Active only while a version is approved and effective. The
  // record's own status can run ahead of its versions, so say what the versions
  // say rather than "Active" beside "No effective version".
  const status =
    p.status === 'active' && versions.data && !effectiveVersion
      ? versions.data.some((v) => v.status === 'in_review')
        ? protocolStatus('under_review')
        : protocolStatus('draft')
      : protocolStatus(p.status)

  const blockColumns: RegistryColumn<ProtocolBlock>[] = [
    {
      id: 'order',
      header: t('library.protocols.detail.order'),
      cell: ({ row }) => row.original.order,
      meta: {
        ...rightAligned<ProtocolBlock>().meta,
        cellClassName: 'num text-right',
      },
    },
    {
      id: 'block',
      header: t('library.protocols.detail.block'),
      cell: ({ row }) => row.original.type,
    },
    {
      id: 'edits',
      header: t('library.protocols.detail.edits'),
      cell: ({ row }) => row.original.version,
      meta: { cellClassName: 'text-fg-muted' },
    },
  ]

  const linkColumns: RegistryColumn<ProtocolLink>[] = [
    {
      id: 'record',
      header: t('library.protocols.detail.record'),
      cell: ({ row }) => (
        <ObjectLink
          kind={row.original.targetKind}
          id={row.original.targetRecordId}
          identifier={row.original.targetIdentifier}
        />
      ),
    },
    {
      id: 'kind',
      header: t('library.protocols.detail.kind'),
      cell: ({ row }) => row.original.targetKind,
    },
    {
      id: 'link',
      header: t('library.protocols.detail.link'),
      cell: ({ row }) => row.original.linkType,
      meta: { cellClassName: 'text-fg-muted' },
    },
  ]

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        trail={[
          {
            label: t('library.protocols.detail.protocols'),
            link: { to: '/protocols' },
          },
          { label: p.identifier, mono: true },
        ]}
        title={p.title}
        actions={
          <>
            <FavouriteToggle kind="record" objectId={p.id} />
            <Button onClick={() => window.print()}>
              {t('library.protocols.detail.exportPdf')}
            </Button>
            <Button
              nativeButton={false}
              render={
                <Link
                  to="/records/$recordId/notebook"
                  params={{ recordId: p.id }}
                />
              }
            >
              {t('library.protocols.detail.openWorkingDocument')}
            </Button>
            {effectiveVersion ? (
              <Button
                variant="primary"
                nativeButton={false}
                render={
                  <Link
                    to="/experiments/new"
                    search={{
                      protocol: p.id,
                      returnTo: `/protocols/${encodeURIComponent(p.id)}`,
                    }}
                  />
                }
              >
                {t('library.protocols.detail.newExperimentFromThis')}
              </Button>
            ) : null}
          </>
        }
        meta={
          <>
            <span className="text-fg">
              <Status tone={status.tone}>{status.label}</Status>
            </span>
            <span>
              {effectiveVersion
                ? t('library.protocols.detail.effectiveV', {
                    version: effectiveVersion.version,
                  })
                : t('library.protocols.detail.noEffectiveVersion')}
            </span>
            {effectiveVersion?.effective_at ? (
              <span className="max-lg:hidden">
                {t('library.protocols.detail.effectiveSince', {
                  effectiveAt: formatDate(effectiveVersion.effective_at),
                })}
              </span>
            ) : null}
            {effectiveVersion?.review_due_at ? (
              <span className="max-lg:hidden">
                {t('library.protocols.detail.reviewDue', {
                  reviewDueAt: formatDate(effectiveVersion.review_due_at),
                })}
              </span>
            ) : null}
            <span>
              {t('library.protocols.detail.owner', {
                names: names.userLabel(p.createdByUserId),
              })}
            </span>
            <span className="max-lg:hidden">
              {t('library.protocols.detail.updated', {
                updatedAt: formatDate(p.updatedAt),
              })}
            </span>
          </>
        }
        tabs={
          <Tabs
            mode="url"
            label={t('library.protocols.detail.protocolSections')}
            value={tab}
            items={(
              [
                ['document', t('library.protocols.detail.document'), undefined],
                [
                  'template',
                  t('library.protocols.detail.template'),
                  blocks.data?.length,
                ],
                [
                  'usedby',
                  t('library.protocols.detail.usedBy'),
                  links.data?.length,
                ],
                [
                  'versions',
                  t('library.protocols.detail.versions'),
                  versions.data?.length,
                ],
                ['training', t('library.protocols.detail.training'), undefined],
              ] as [ProtocolTab, string, number | undefined][]
            ).map(([key, label, count]) => ({
              key,
              label,
              count,
              link: {
                search: { section: key === 'document' ? undefined : key },
              },
            }))}
          />
        }
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'document' ? (
          <div className="flex min-h-full">
            <div className="mx-auto flex min-w-0 w-full max-w-[760px] flex-1 flex-col gap-4 px-4 py-4 md:px-6">
              {versionRows.length > 1 ? (
                <label className="flex items-center gap-2 text-label text-fg-muted">
                  {t('library.protocols.detail.version')}
                  <Select
                    aria-label={t('library.protocols.detail.protocolVersion')}
                    value={shownVersion?.id ?? ''}
                    onChange={(e) => setPickedVersionId(e.target.value)}
                  >
                    {versionRows.map((v) => (
                      <option key={v.id} value={v.id}>
                        {t('library.protocols.detail.version2', {
                          version: v.version,
                          status: v.status.replace(/_/g, ' '),
                        })}
                      </option>
                    ))}
                  </Select>
                </label>
              ) : null}
              {shownVersion && snapshot.data ? (
                <ProtocolDocument
                  blocks={[...snapshot.data.block_snapshot].sort(
                    (a, b) => a.order - b.order,
                  )}
                />
              ) : blocks.isPending || (shownVersion && snapshot.isPending) ? (
                <p role="status">
                  {t('library.protocols.detail.loadingProtocolDocument')}
                </p>
              ) : blocks.isError ? (
                <p role="alert">
                  {t('library.protocols.detail.theProtocolDocumentCouldNot')}
                </p>
              ) : (
                <Section title={t('library.protocols.detail.workingDocument')}>
                  <ProtocolDocument blocks={blocks.data} />
                </Section>
              )}
            </div>
            <div className="max-lg:hidden">
              <ProtocolInspector
                protocolId={protocolId}
                version={shownVersion}
                versions={versionRows}
              />
            </div>
          </div>
        ) : tab === 'training' ? (
          <div className="px-4 py-4 md:px-6">
            <TrainingTab protocolId={protocolId} />
          </div>
        ) : tab === 'template' ? (
          <div className="px-4 py-4 md:px-6">
            <Section
              title={t('library.protocols.detail.template')}
              count={blocks.data?.length ?? 0}
            >
              {blocks.data?.length ? (
                <TableBox>
                  <RegistryGrid
                    label={t('library.protocols.detail.protocolTemplateBlocks')}
                    rows={blocks.data}
                    columns={blockColumns}
                    getRowId={(b) => b.id}
                    selectable={false}
                  />
                </TableBox>
              ) : (
                <Muted>
                  {t('library.protocols.detail.thisProtocolHasNoNotebook')}
                </Muted>
              )}
            </Section>
          </div>
        ) : tab === 'usedby' ? (
          <div className="px-4 py-4 md:px-6">
            <Section
              title={t('library.protocols.detail.usedBy')}
              count={links.data?.length ?? 0}
            >
              {links.data?.length ? (
                <TableBox>
                  <RegistryGrid
                    label={t(
                      'library.protocols.detail.recordsLinkedToThisProtocol',
                    )}
                    rows={links.data}
                    columns={linkColumns}
                    getRowId={(l) => l.id}
                    selectable={false}
                  />
                </TableBox>
              ) : (
                <Muted>
                  {t('library.protocols.detail.noRecordsLinkToThis')}
                </Muted>
              )}
            </Section>
          </div>
        ) : (
          <div className="px-4 py-4 md:px-6">
            <ProtocolVersionsPanel
              protocolRecordId={protocolId}
              workspaceId={context.workspace?.id}
              role={context.workspace?.role}
              user={{ id: context.user.id, name: context.user.name }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function TrainingTab({ protocolId }: { protocolId: string }) {
  const { context } = Route.useRouteContext()
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const versions = useQuery({
    queryKey: ['ui-port', 'protocol-versions', protocolId],
    queryFn: () => fetchProtocolVersions(notebookDataClient, protocolId),
  })
  const rows = versions.data ?? []
  // Default to the current effective version, falling back to the newest frozen
  // one so a protocol without an effective version is still legible.
  const version =
    rows.find((v) => v.id === selectedId) ??
    rows.find((v) => v.status === 'effective') ??
    rows.at(0)
  const acknowledgements = useQuery({
    queryKey: ['ui-port', 'protocol-acknowledgements', version?.id ?? ''],
    queryFn: () =>
      fetchProtocolAcknowledgements(notebookDataClient, version?.id ?? ''),
    enabled: Boolean(version),
  })
  // GOV-01 / LAB-07 — the RPC refuses a viewer's acknowledgement, so the
  // control is only offered to a writer. The surface asks the same
  // `api.is_workspace_writer` question the server gates on, never a
  // client-invented role.
  const writer = useQuery({
    queryKey: [
      'ui-port',
      'protocol-acknowledge-writer',
      version?.workspace_id ?? '',
    ],
    queryFn: () =>
      fetchProtocolAcknowledgeWriter(
        notebookDataClient,
        version?.workspace_id ?? '',
      ),
    enabled: Boolean(version),
  })
  const members = useQuery({
    queryKey: ['ui-port', 'protocol-training-members'],
    queryFn: () =>
      notebookDataClient.rpc<{ user_id: string; name: string }[]>(
        'workspace_members_list',
        {},
      ),
    staleTime: 60_000,
  })
  const acknowledge = useMutation({
    mutationFn: (versionId: string) =>
      acknowledgeProtocolVersion(notebookDataClient, versionId),
    onSuccess: () => {
      toast(t('library.protocols.detail.versionAcknowledged'))
      void queryClient.invalidateQueries({
        queryKey: ['ui-port', 'protocol-acknowledgements'],
      })
    },
  })

  if (versions.isPending) {
    return (
      <p role="status">
        {t('library.protocols.detail.loadingProtocolVersions')}
      </p>
    )
  }
  if (versions.isError) {
    return (
      <p role="alert">
        {t('library.protocols.detail.theProtocolVersionsCouldNot')}
      </p>
    )
  }
  if (!version) {
    return (
      <EmptyState
        icon="protocol"
        title={t('library.protocols.detail.noFrozenVersionsYet')}
        description={t('library.protocols.detail.aVersionIsFrozenWhen')}
      />
    )
  }

  // The writer capability decides whether an acknowledgement is offered at
  // all. Rendering before it resolves would flash an actionable control to an
  // identity the server would refuse, so the section waits for the answer.
  if (writer.isPending) {
    return (
      <p role="status">
        {t('library.protocols.detail.loadingProtocolTraining')}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {rows.length > 1 ? (
        <label className="flex items-center gap-2 text-label text-fg-muted">
          {t('library.protocols.detail.version')}
          <Select
            aria-label={t('library.protocols.detail.protocolVersion')}
            value={version.id}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            {rows.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.version} · {v.status.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
        </label>
      ) : null}
      <ProtocolTrainingRoster
        protocolId={protocolId}
        members={members.data ?? []}
        writer={writer.data ?? false}
      />
      <ProtocolVersionTraining
        version={version}
        members={members.data ?? []}
        acknowledgements={acknowledgements.data ?? []}
        currentUserId={context.user.id}
        acknowledging={acknowledge.isPending}
        error={
          acknowledge.error instanceof Error
            ? acknowledge.error.message
            : undefined
        }
        writer={writer.data ?? false}
        onAcknowledge={() => acknowledge.mutate(version.id)}
      />
    </div>
  )
}
