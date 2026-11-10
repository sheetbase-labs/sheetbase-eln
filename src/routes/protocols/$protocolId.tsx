import { useState } from 'react'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ProtocolDocument } from '#/components/protocols/protocol-document'
import { ProtocolHazards } from '#/components/protocols/protocol-hazards'
import { ProtocolInspector } from '#/components/protocols/protocol-inspector'
import {
  ProtocolVersionsPanel,
  protocolVersionsKey,
} from '#/components/protocols/protocol-versions-panel'
import { ProtocolTrainingRoster } from '#/components/protocols/protocol-training-roster'
import { ProtocolVersionTraining } from '#/components/protocols/protocol-version-training'
import { ObjectLink } from '#/components/ui/object-link'
import { Tabs } from '#/components/ui/tabs'
import { PageHeader, Muted, Section } from '#/components/ui/layout'
import { Status } from '#/components/ui/status'
import { EmptyState } from '#/components/ui/empty-state'
import { FavouriteToggle } from '#/components/favourites/favourite-toggle'
import { FollowToggle } from '#/components/follow/follow-toggle'
import { Button } from '#/components/ui/button'
import { useRecentViewTracking } from '#/lib/recents'
import { Select } from '#/components/ui/select'
import { toast } from '#/components/ui/sonner'
import { TableBox } from '#/components/ui/table'
import {
  RegistryGrid,
  rightAligned,
} from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
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
import { protocolStatus } from '#/components/protocols/protocols-registry-grid'
import type { ProtocolStatus } from '#/components/protocols/protocol-status'
import type { ProtocolVersion } from '#/lib/controlled-protocols'
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
const protocolSearchSchema = z.object({
  section: z.enum(tabs).optional().catch(undefined),
})

type ProtocolSearch = z.infer<typeof protocolSearchSchema>

export const Route = createFileRoute('/protocols/$protocolId')({
  validateSearch: (search): ProtocolSearch =>
    protocolSearchSchema.parse(search),
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth

    if (!context) {
      throw redirect(signInRedirect(location))
    }

    return { context }
  },
  component: ProtocolPage,
})

type ProtocolBlock = NonNullable<
  Awaited<ReturnType<typeof fetchBlocksForRecord>>
>[number]

type ProtocolLink = NonNullable<
  Awaited<ReturnType<typeof fetchLinksForRecord>>
>[number]

type ProtocolRecord = NonNullable<Awaited<ReturnType<typeof fetchRecord>>>

type ProtocolSnapshotBlock = NonNullable<
  Awaited<ReturnType<typeof fetchRevision>>
>['block_snapshot'][number]

/** The protocol's sections, with how many things each one holds. */
function ProtocolSectionTabs({
  tab,
  counts,
}: {
  tab: ProtocolTab
  counts: { blocks: number; links: number; versions: number }
}): React.ReactElement {
  const items: [ProtocolTab, string, number | undefined][] = [
    ['document', t('library.protocols.detail.document'), undefined],
    ['template', t('library.protocols.detail.template'), counts.blocks],
    ['usedby', t('library.protocols.detail.usedBy'), counts.links],
    ['versions', t('library.protocols.detail.versions'), counts.versions],
    ['training', t('library.protocols.detail.training'), undefined],
  ]

  return (
    <Tabs
      mode="url"
      label={t('library.protocols.detail.protocolSections')}
      value={tab}
      items={items.map(([key, label, count]) => ({
        key,
        label,
        count,
        link: {
          search: { section: key === 'document' ? undefined : key },
        },
      }))}
    />
  )
}

/** What this protocol is, how it stands, and what can be done with it. */
function ProtocolHeader({
  protocol,
  status,
  effectiveVersion,
  ownerLabel,
  tab,
  counts,
}: {
  protocol: ProtocolRecord
  status: ProtocolStatus
  effectiveVersion: ProtocolVersion | undefined
  ownerLabel: string
  tab: ProtocolTab
  counts: { blocks: number; links: number; versions: number }
}): React.ReactElement {
  return (
    <PageHeader
      trail={[
        {
          label: t('library.protocols.detail.protocols'),
          link: { to: '/protocols' },
        },
        { label: protocol.identifier, mono: true },
      ]}
      title={protocol.title}
      actions={
        <>
          <FavouriteToggle kind="record" objectId={protocol.id} />
          <FollowToggle kind="record" objectId={protocol.id} />
          <Button onClick={() => window.print()}>
            {t('library.protocols.detail.exportPdf')}
          </Button>
          <Button
            nativeButton={false}
            render={
              <Link
                to="/records/$recordId/notebook"
                params={{ recordId: protocol.id }}
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
                    protocol: protocol.id,
                    returnTo: `/protocols/${encodeURIComponent(protocol.id)}`,
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
            {t('library.protocols.detail.owner', { names: ownerLabel })}
          </span>
          <span className="max-lg:hidden">
            {t('library.protocols.detail.updated', {
              updatedAt: formatDate(protocol.updatedAt),
            })}
          </span>
        </>
      }
      tabs={<ProtocolSectionTabs tab={tab} counts={counts} />}
    />
  )
}

/** The controlled document: the chosen frozen version, else the working text. */
function ProtocolDocumentTab({
  protocolId,
  hazards,
  blocks,
  blocksPending,
  blocksError,
  versionRows,
  shownVersion,
  snapshotBlocks,
  snapshotPending,
  onPickVersion,
}: {
  protocolId: string
  hazards: ProtocolLink[]
  blocks: ProtocolBlock[] | undefined
  blocksPending: boolean
  blocksError: boolean
  versionRows: ProtocolVersion[]
  shownVersion: ProtocolVersion | undefined
  snapshotBlocks: ProtocolSnapshotBlock[] | null
  snapshotPending: boolean
  onPickVersion: (versionId: string) => void
}): React.ReactElement {
  return (
    <div className="flex min-h-full">
      <div className="mx-auto flex min-w-0 w-full max-w-[760px] flex-1 flex-col gap-4 px-4 py-4 md:px-6">
        <ProtocolHazards links={hazards} />
        {versionRows.length > 1 ? (
          <label className="flex items-center gap-2 text-label text-fg-muted">
            {t('library.protocols.detail.version')}
            <Select
              aria-label={t('library.protocols.detail.protocolVersion')}
              value={shownVersion?.id ?? ''}
              onChange={(e) => onPickVersion(e.target.value)}
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
        <ProtocolVersionedDocument
          version={shownVersion}
          snapshotBlocks={snapshotBlocks}
          snapshotPending={snapshotPending}
          blocks={blocks}
          blocksPending={blocksPending}
          blocksError={blocksError}
        />
      </div>
      <div className="max-lg:hidden">
        <ProtocolInspector
          protocolId={protocolId}
          version={shownVersion}
          versions={versionRows}
        />
      </div>
    </div>
  )
}

/**
 * The frozen snapshot of the version being read, or the working document when
 * no version is frozen yet.
 */
function ProtocolVersionedDocument({
  version,
  snapshotBlocks,
  snapshotPending,
  blocks,
  blocksPending,
  blocksError,
}: {
  version: ProtocolVersion | undefined
  snapshotBlocks: ProtocolSnapshotBlock[] | null
  snapshotPending: boolean
  blocks: ProtocolBlock[] | undefined
  blocksPending: boolean
  blocksError: boolean
}): React.ReactElement {
  if (version && snapshotBlocks)
    return (
      <ProtocolDocument
        blocks={[...snapshotBlocks].sort((a, b) => a.order - b.order)}
      />
    )

  if (blocksPending || (version && snapshotPending))
    return (
      <p role="status">
        {t('library.protocols.detail.loadingProtocolDocument')}
      </p>
    )

  if (blocksError)
    return (
      <p role="alert">
        {t('library.protocols.detail.theProtocolDocumentCouldNot')}
      </p>
    )

  return (
    <Section title={t('library.protocols.detail.workingDocument')}>
      <ProtocolDocument blocks={blocks ?? []} />
    </Section>
  )
}

/** The working document's blocks, as the template they start from. */
function ProtocolTemplateTab({
  blocks,
}: {
  blocks: ProtocolBlock[] | undefined
}): React.ReactElement {
  const columns: RegistryColumn<ProtocolBlock>[] = [
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

  return (
    <div className="px-4 py-4 md:px-6">
      <Section
        title={t('library.protocols.detail.template')}
        count={blocks?.length ?? 0}
      >
        {blocks?.length ? (
          <TableBox>
            <RegistryGrid
              label={t('library.protocols.detail.protocolTemplateBlocks')}
              rows={blocks}
              columns={columns}
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
  )
}

/** The records that point at this protocol. */
function ProtocolUsedByTab({
  links,
}: {
  links: ProtocolLink[] | undefined
}): React.ReactElement {
  const columns: RegistryColumn<ProtocolLink>[] = [
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
    <div className="px-4 py-4 md:px-6">
      <Section
        title={t('library.protocols.detail.usedBy')}
        count={links?.length ?? 0}
      >
        {links?.length ? (
          <TableBox>
            <RegistryGrid
              label={t('library.protocols.detail.recordsLinkedToThisProtocol')}
              rows={links}
              columns={columns}
              getRowId={(l) => l.id}
              selectable={false}
            />
          </TableBox>
        ) : (
          <Muted>{t('library.protocols.detail.noRecordsLinkToThis')}</Muted>
        )}
      </Section>
    </div>
  )
}

/** The selected section, rendered from the queries the page already holds. */
function ProtocolTabBody({
  tab,
  protocolId,
  context,
  links,
  blocks,
  blocksPending,
  blocksError,
  versionRows,
  shownVersion,
  snapshotBlocks,
  snapshotPending,
  onPickVersion,
}: {
  tab: ProtocolTab
  protocolId: string
  context: ReturnType<typeof Route.useRouteContext>['context']
  links: ProtocolLink[] | undefined
  blocks: ProtocolBlock[] | undefined
  blocksPending: boolean
  blocksError: boolean
  versionRows: ProtocolVersion[]
  shownVersion: ProtocolVersion | undefined
  snapshotBlocks: ProtocolSnapshotBlock[] | null
  snapshotPending: boolean
  onPickVersion: (versionId: string) => void
}): React.ReactElement {
  if (tab === 'document')
    return (
      <ProtocolDocumentTab
        protocolId={protocolId}
        hazards={links ?? []}
        blocks={blocks}
        blocksPending={blocksPending}
        blocksError={blocksError}
        versionRows={versionRows}
        shownVersion={shownVersion}
        snapshotBlocks={snapshotBlocks}
        snapshotPending={snapshotPending}
        onPickVersion={onPickVersion}
      />
    )

  if (tab === 'training')
    return (
      <div className="px-4 py-4 md:px-6">
        <TrainingTab protocolId={protocolId} />
      </div>
    )

  if (tab === 'template') return <ProtocolTemplateTab blocks={blocks} />

  if (tab === 'usedby') return <ProtocolUsedByTab links={links} />

  return (
    <div className="px-4 py-4 md:px-6">
      <ProtocolVersionsPanel
        protocolRecordId={protocolId}
        workspaceId={context.workspace?.id}
        role={context.workspace?.role}
        user={{ id: context.user.id, name: context.user.name }}
      />
    </div>
  )
}

/**
 * A protocol is Active only while a version is approved and effective. The
 * record's own status can run ahead of its versions, so say what the versions
 * say rather than "Active" beside "No effective version".
 */
function protocolRecordStatus(
  protocol: ProtocolRecord,
  versions: ProtocolVersion[],
  effectiveVersion: ProtocolVersion | undefined,
): ProtocolStatus {
  if (protocol.status !== 'active' || effectiveVersion) {
    return protocolStatus(protocol.status)
  }

  if (versions.length === 0) return protocolStatus(protocol.status)

  return versions.some((v) => v.status === 'in_review')
    ? protocolStatus('under_review')
    : protocolStatus('draft')
}

/** The protocol is gone, or still loading: either way there is no frame yet. */
function ProtocolUnavailable({
  loading,
}: {
  loading: boolean
}): React.ReactElement {
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
          loading
            ? t('library.protocols.detail.loadingProtocol')
            : t('library.protocols.detail.protocolNotFound')
        }
      />
      {loading ? null : (
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

  const names = useUserNames(record.data ? [record.data.createdByUserId] : [])

  const p = record.data
  useRecentViewTracking('record', p?.kind === 'protocol_template' ? p.id : null)

  if (!p || p.kind !== 'protocol_template')
    return <ProtocolUnavailable loading={record.isLoading} />

  const effectiveVersion = versions.data?.find((v) => v.status === 'effective')

  const status = protocolRecordStatus(p, versions.data ?? [], effectiveVersion)

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <ProtocolHeader
        protocol={p}
        status={status}
        effectiveVersion={effectiveVersion}
        ownerLabel={names.userLabel(p.createdByUserId)}
        tab={tab}
        counts={{
          blocks: blocks.data?.length ?? 0,
          links: links.data?.length ?? 0,
          versions: versions.data?.length ?? 0,
        }}
      />
      <div className="min-h-0 flex-1 overflow-auto max-md:pb-20">
        <ProtocolTabBody
          tab={tab}
          protocolId={protocolId}
          context={context}
          links={links.data}
          blocks={blocks.data}
          blocksPending={blocks.isPending}
          blocksError={blocks.isError}
          versionRows={versionRows}
          shownVersion={shownVersion}
          snapshotBlocks={snapshot.data?.block_snapshot ?? null}
          snapshotPending={snapshot.isPending}
          onPickVersion={setPickedVersionId}
        />
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
    <ProtocolTrainingPanel
      protocolId={protocolId}
      versions={rows}
      version={version}
      onSelect={setSelectedId}
      members={members.data ?? []}
      acknowledgements={acknowledgements.data ?? []}
      currentUserId={context.user.id}
      writer={writer.data ?? false}
      acknowledging={acknowledge.isPending}
      failure={acknowledge.error}
      onAcknowledge={() => acknowledge.mutate(version.id)}
    />
  )
}

/** The version being trained on, its roster, and who has acknowledged it. */
function ProtocolTrainingPanel({
  protocolId,
  versions,
  version,
  onSelect,
  members,
  acknowledgements,
  currentUserId,
  writer,
  acknowledging,
  failure,
  onAcknowledge,
}: {
  protocolId: string
  versions: ProtocolVersion[]
  version: ProtocolVersion
  onSelect: (versionId: string) => void
  members: { user_id: string; name: string }[]
  acknowledgements: Awaited<ReturnType<typeof fetchProtocolAcknowledgements>>
  currentUserId: string
  writer: boolean
  acknowledging: boolean
  failure: unknown
  onAcknowledge: () => void
}): React.ReactElement {
  // A version is picked from the frozen list; the newest is the default.
  const pickerView =
    versions.length > 1 ? (
      <label className="flex items-center gap-2 text-label text-fg-muted">
        {t('library.protocols.detail.version')}
        <Select
          aria-label={t('library.protocols.detail.protocolVersion')}
          value={version.id}
          onChange={(e) => onSelect(e.target.value)}
        >
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              v{v.version} · {v.status.replace(/_/g, ' ')}
            </option>
          ))}
        </Select>
      </label>
    ) : null

  return (
    <div className="flex flex-col gap-4">
      {pickerView}
      <ProtocolTrainingRoster
        protocolId={protocolId}
        members={members}
        writer={writer}
      />
      <ProtocolVersionTraining
        version={version}
        members={members}
        acknowledgements={acknowledgements}
        currentUserId={currentUserId}
        acknowledging={acknowledging}
        error={failure instanceof Error ? failure.message : undefined}
        writer={writer}
        onAcknowledge={onAcknowledge}
      />
    </div>
  )
}
