import { useState } from 'react'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { PageHeader, Muted, Section } from '#/components/v3/ui/layout'
import { Status } from '#/components/v3/ui/status'
import { EmptyState } from '#/components/v3/ui/empty-state'
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
import { useUserNames } from '#/lib/user-names'
import { protocolStatus } from '../protocols'

const tabs = ['document', 'template', 'usedby', 'versions'] as const
type ProtocolTab = (typeof tabs)[number]

/** UI port (roadmap-4/ui-app3): the protocol detail frame. The record's
 * notebook structure and links are real; the controlled document, approval
 * chain and training are later capabilities and are stated as gaps. */
export const Route = createFileRoute('/protocols/$protocolId')({
  validateSearch: (search: Record<string, unknown>): { tab?: ProtocolTab } => ({
    tab:
      search.tab === 'template' ||
      search.tab === 'usedby' ||
      search.tab === 'versions' ||
      search.tab === 'document'
        ? search.tab
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
  const [tab, setTab] = useState<ProtocolTab>('document')
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
  const names = useUserNames(record.data ? [record.data.createdByUserId] : [])
  const p = record.data

  if (!p) {
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
          <nav aria-label="Protocol sections" className="flex gap-5">
            {(
              [
                ['document', 'Document', undefined],
                ['template', 'Template', blocks.data?.length],
                ['usedby', 'Used by', links.data?.length],
                ['versions', 'Versions', undefined],
              ] as [ProtocolTab, string, number | undefined][]
            ).map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                aria-current={tab === key ? 'page' : undefined}
                onClick={() => setTab(key)}
                className={
                  tab === key
                    ? 'inline-flex h-9 cursor-pointer items-center gap-1.5 border-0 border-b-2 border-link bg-transparent px-0.5 text-body font-medium text-fg'
                    : 'inline-flex h-9 cursor-pointer items-center gap-1.5 border-0 border-b-2 border-transparent bg-transparent px-0.5 text-body font-medium text-fg-muted hover:text-fg'
                }
              >
                {label}
                {count != null ? (
                  <span className="text-label font-normal text-fg-muted">
                    {count}
                  </span>
                ) : null}
              </button>
            ))}
          </nav>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'document' ? (
          <div className="px-4 py-4 md:px-6">
            <EmptyState
              icon="protocol"
              title="The controlled document is not modelled yet"
              body="Purpose, parameters, procedure and acceptance criteria are a later capability. The protocol record, its template and its links are real today."
            />
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
            <EmptyState
              icon="protocol"
              title="Version history is not modelled yet"
              body="Controlled versions with approval chains are a later capability; new experiments will pin the version they start from."
            />
          </div>
        )}
      </div>
    </div>
  )
}
