import { useState } from 'react'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ProtocolDocument } from '#/components/v3/protocols/protocol-document'
import { ProtocolInspector } from '#/components/v3/protocols/protocol-inspector'
import {
  ProtocolVersionsPanel,
  protocolVersionsKey,
} from '#/components/v3/protocols/protocol-versions-panel'
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
          trail={[{ label: 'Protocols', link: { to: '/protocols' } }]}
          title={record.isLoading ? 'Loading protocol…' : 'Protocol not found'}
        />
        {record.isLoading ? null : (
          <div className="px-4 py-4 md:px-6">
            <EmptyState
              icon="protocol"
              title="This protocol isn’t available to you"
              description="It may have been removed, may not be a protocol, or sits in a project you can’t view. Ask the project owner for access, or pick another protocol."
              action={
                <Button nativeButton={false} render={<Link to="/protocols" />}>
                  Back to protocols
                </Button>
              }
            />
          </div>
        )}
      </div>
    )
  }
  const status = protocolStatus(p.status)
  type ProtocolBlock = NonNullable<typeof blocks.data>[number]
  type ProtocolLink = NonNullable<typeof links.data>[number]
  const effectiveVersion = versions.data?.find((v) => v.status === 'effective')

  const blockColumns: RegistryColumn<ProtocolBlock>[] = [
    {
      id: 'order',
      header: 'Order',
      cell: ({ row }) => row.original.order,
      meta: {
        ...rightAligned<ProtocolBlock>().meta,
        cellClassName: 'num text-right',
      },
    },
    { id: 'block', header: 'Block', cell: ({ row }) => row.original.type },
    {
      id: 'edits',
      header: 'Edits',
      cell: ({ row }) => row.original.version,
      meta: { cellClassName: 'text-fg-muted' },
    },
  ]

  const linkColumns: RegistryColumn<ProtocolLink>[] = [
    {
      id: 'record',
      header: 'Record',
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
      header: 'Kind',
      cell: ({ row }) => row.original.targetKind,
    },
    {
      id: 'link',
      header: 'Link',
      cell: ({ row }) => row.original.linkType,
      meta: { cellClassName: 'text-fg-muted' },
    },
  ]

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        trail={[
          { label: 'Protocols', link: { to: '/protocols' } },
          { label: p.identifier, mono: true },
        ]}
        title={p.title}
        actions={
          <>
            <FavouriteToggle kind="record" objectId={p.id} />
            <Button onClick={() => window.print()}>Export PDF</Button>
            <Button
              nativeButton={false}
              render={
                <Link
                  to="/records/$recordId/notebook"
                  params={{ recordId: p.id }}
                />
              }
            >
              Open working document
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
                New experiment from this
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
                ? `Effective v${effectiveVersion.version}`
                : 'No effective version'}
            </span>
            {effectiveVersion?.effective_at ? (
              <span className="max-lg:hidden">
                Effective since {effectiveVersion.effective_at.slice(0, 10)}
              </span>
            ) : null}
            {effectiveVersion?.review_due_at ? (
              <span className="max-lg:hidden">
                Review due {effectiveVersion.review_due_at.slice(0, 10)}
              </span>
            ) : null}
            <span>Owner {names.userLabel(p.createdByUserId)}</span>
            <span className="max-lg:hidden">
              Updated {p.updatedAt.slice(0, 10)}
            </span>
          </>
        }
        tabs={
          <Tabs
            mode="url"
            label="Protocol sections"
            value={tab}
            items={(
              [
                ['document', 'Document', undefined],
                ['template', 'Template', blocks.data?.length],
                ['usedby', 'Used by', links.data?.length],
                ['versions', 'Versions', versions.data?.length],
                ['training', 'Training', undefined],
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
                  Version
                  <Select
                    aria-label="Protocol version"
                    value={shownVersion?.id ?? ''}
                    onChange={(e) => setPickedVersionId(e.target.value)}
                  >
                    {versionRows.map((v) => (
                      <option key={v.id} value={v.id}>
                        Version {v.version} · {v.status.replace(/_/g, ' ')}
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
                <p role="status">Loading protocol document…</p>
              ) : blocks.isError ? (
                <p role="alert">The protocol document could not be loaded.</p>
              ) : (
                <Section title="Working document">
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
            <Section title="Template" count={blocks.data?.length ?? 0}>
              {blocks.data?.length ? (
                <TableBox className="max-w-[900px]">
                  <RegistryGrid
                    label="Protocol template blocks"
                    rows={blocks.data}
                    columns={blockColumns}
                    getRowId={(b) => b.id}
                    selectable={false}
                  />
                </TableBox>
              ) : (
                <Muted>This protocol has no notebook structure yet.</Muted>
              )}
            </Section>
          </div>
        ) : tab === 'usedby' ? (
          <div className="px-4 py-4 md:px-6">
            <Section title="Used by" count={links.data?.length ?? 0}>
              {links.data?.length ? (
                <TableBox className="max-w-[900px]">
                  <RegistryGrid
                    label="Records linked to this protocol"
                    rows={links.data}
                    columns={linkColumns}
                    getRowId={(l) => l.id}
                    selectable={false}
                  />
                </TableBox>
              ) : (
                <Muted>
                  No records link to this protocol yet. Links appear here when
                  an experiment starts from it.
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
      toast('Version acknowledged')
      void queryClient.invalidateQueries({
        queryKey: ['ui-port', 'protocol-acknowledgements'],
      })
    },
  })

  if (versions.isPending) {
    return <p role="status">Loading protocol versions…</p>
  }
  if (versions.isError) {
    return <p role="alert">The protocol versions could not be loaded.</p>
  }
  if (!version) {
    return (
      <EmptyState
        icon="protocol"
        title="No frozen versions yet"
        description="A version is frozen when the protocol is submitted for review. Acknowledgement is recorded against the exact frozen version, and an experiment can only start from a version its operator has acknowledged."
      />
    )
  }

  // The writer capability decides whether an acknowledgement is offered at
  // all. Rendering before it resolves would flash an actionable control to an
  // identity the server would refuse, so the section waits for the answer.
  if (writer.isPending) {
    return <p role="status">Loading protocol training…</p>
  }

  return (
    <div className="flex flex-col gap-4">
      {rows.length > 1 ? (
        <label className="flex items-center gap-2 text-label text-fg-muted">
          Version
          <Select
            aria-label="Protocol version"
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
