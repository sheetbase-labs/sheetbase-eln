import { useState } from 'react'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ProtocolDocument } from '#/components/v3/protocols/protocol-document'
import { ProtocolVersionTraining } from '#/components/v3/protocols/protocol-version-training'
import { Tabs } from '#/components/v3/ui/tabs'
import { PageHeader, Muted, Section } from '#/components/v3/ui/layout'
import { Status } from '#/components/v3/ui/status'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Select } from '#/components/v3/ui/select'
import { toast } from '#/components/v3/ui/sonner'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import {
  fetchBlocksForRecord,
  fetchRecord,
  fetchLinksForRecord,
  notebookDataClient,
  notebookQueryKeys,
} from '#/lib/notebook-data'
import type { RevisionWire } from '#/lib/notebook-data'
import {
  acknowledgeProtocolVersion,
  fetchProtocolAcknowledgements,
  fetchProtocolAcknowledgeWriter,
  fetchProtocolVersions,
} from '#/lib/controlled-protocols'
import { useUserNames } from '#/lib/user-names'
import { protocolStatus } from '#/components/v3/protocols/protocols-registry-grid'

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
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: ProtocolPage,
})

function ProtocolPage() {
  const { protocolId } = Route.useParams()
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
  const revisions = useQuery({
    queryKey: ['ui-port', 'protocol-revisions', protocolId],
    queryFn: () =>
      notebookDataClient.list<RevisionWire>(
        'revisions',
        `?record_id=eq.${encodeURIComponent(protocolId)}&order=created_at.desc,id.desc&limit=50`,
      ),
  })
  const names = useUserNames([
    ...(record.data ? [record.data.createdByUserId] : []),
    ...(revisions.data ?? []).map((r) => r.created_by_user_id),
  ])
  const p = record.data

  if (!p || p.kind !== 'protocol_template') {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          crumbs={
            <Link to="/protocols" className="text-link">
              Protocols
            </Link>
          }
          title={record.isLoading ? 'Loading protocol…' : 'Protocol not found'}
        />
      </div>
    )
  }
  const status = protocolStatus(p.status)
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        crumbs={
          <>
            <Link to="/protocols" className="text-link">
              Protocols
            </Link>{' '}
            / <span className="mono">{p.identifier}</span>
          </>
        }
        title={p.title}
        meta={
          <>
            <span className="text-fg">
              <Status tone={status.tone}>{status.label}</Status>
            </span>
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
                ['versions', 'Versions', revisions.data?.length],
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
          <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 px-4 py-4 md:px-6">
            <Section title="Working document">
              {blocks.isPending ? (
                <p role="status">Loading protocol document…</p>
              ) : blocks.isError ? (
                <p role="alert">The protocol document could not be loaded.</p>
              ) : (
                <ProtocolDocument blocks={blocks.data} />
              )}
            </Section>
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
                  <Table aria-label="Protocol template blocks">
                    <TableHeader>
                      <TableRow>
                        <TableHead align="right">Order</TableHead>
                        <TableHead>Block</TableHead>
                        <TableHead>Version</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {blocks.data.map((b) => (
                        <TableRow key={b.id}>
                          <TableCell align="right" className="num">
                            {b.order}
                          </TableCell>
                          <TableCell>{b.type}</TableCell>
                          <TableCell className="text-fg-muted">
                            v{b.version}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
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
                  <Table aria-label="Records linked to this protocol">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Record</TableHead>
                        <TableHead>Kind</TableHead>
                        <TableHead>Link</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {links.data.map((l) => (
                        <TableRow key={l.id}>
                          <TableCell className="mono">
                            {l.targetIdentifier}
                          </TableCell>
                          <TableCell>{l.targetKind}</TableCell>
                          <TableCell className="text-fg-muted">
                            {l.linkType}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
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
            <Section
              title="Version history"
              count={revisions.data?.length ?? 0}
            >
              {revisions.data?.length ? (
                <TableBox className="max-w-[900px]">
                  <Table aria-label="Protocol version history">
                    <TableHeader>
                      <TableRow>
                        <TableHead align="right">Version</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>Author</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead aria-label="Actions" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {revisions.data.map((r, i) => (
                        <TableRow key={r.id}>
                          <TableCell align="right" className="num">
                            v{revisions.data.length - i}
                          </TableCell>
                          <TableCell>{r.reason}</TableCell>
                          <TableCell>
                            {names.userLabel(r.created_by_user_id)}
                          </TableCell>
                          <TableCell className="text-fg-muted">
                            {r.created_at.slice(0, 16).replace('T', ' ')}
                          </TableCell>
                          <TableCell align="right">
                            <Link
                              to="/evidence/$revisionId"
                              params={{ revisionId: r.id }}
                              className="text-link"
                            >
                              Evidence
                            </Link>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableBox>
              ) : (
                <EmptyState
                  icon="protocol"
                  title="No frozen versions yet"
                  body="A version is frozen when the protocol is submitted for review. New experiments pin the version they start from."
                />
              )}
            </Section>
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
        body="A version is frozen when the protocol is submitted for review. Acknowledgement is recorded against the exact frozen version, and an experiment can only start from a version its operator has acknowledged."
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
