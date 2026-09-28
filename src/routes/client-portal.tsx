import { useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Status } from '#/components/v3/ui/status'
import { Muted } from '#/components/v3/ui/layout'
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
import { Button } from '#/components/v3/ui/button'
import { Icon } from '#/components/v3/icons'
import { Textarea } from '#/components/v3/inventory/list'
import {
  clientPortalQueryKeys,
  fetchClientPortalIdentity,
  fetchClientPortalMessages,
  fetchClientPortalProjects,
  fetchClientPortalRecords,
  postClientPortalMessage,
} from '#/lib/client-portal'

/** UI port (roadmap-4/ui-app3): the client portal (ADR-0049). A client viewer
 * sees only approved records explicitly shared to their client, read through
 * the portal RPCs — there is no app shell and no internal read access. Reports
 * and messages are later capabilities and are stated as gaps. */
export const Route = createFileRoute('/client-portal')({
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: ClientPortal,
})

const tabs = ['projects', 'reports', 'messages'] as const
type PortalTab = (typeof tabs)[number]
const tabLabel: Record<PortalTab, string> = {
  projects: 'Projects',
  reports: 'Reports',
  messages: 'Messages',
}
const tabIcon: Record<PortalTab, 'folder' | 'protocol' | 'inbox'> = {
  projects: 'folder',
  reports: 'protocol',
  messages: 'inbox',
}

function ClientPortal() {
  const { context } = Route.useRouteContext()
  const [tab, setTab] = useState<PortalTab>('projects')
  const projects = useQuery({
    queryKey: clientPortalQueryKeys.projects,
    queryFn: () => fetchClientPortalProjects(),
  })
  const records = useQuery({
    queryKey: clientPortalQueryKeys.records,
    queryFn: () => fetchClientPortalRecords(),
  })
  const identity = useQuery({
    queryKey: clientPortalQueryKeys.identity,
    queryFn: () => fetchClientPortalIdentity(),
  })
  const isClient = Boolean(identity.data)
  const messages = useQuery({
    queryKey: clientPortalQueryKeys.messages,
    queryFn: () => fetchClientPortalMessages(),
    enabled: isClient,
  })
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState('')
  const send = useMutation({
    mutationFn: () => postClientPortalMessage(draft.trim()),
    onSuccess: () => {
      setDraft('')
      void queryClient.invalidateQueries({
        queryKey: clientPortalQueryKeys.messages,
      })
    },
  })
  const client = projects.data?.[0]

  return (
    <div className="flex h-dvh flex-col bg-surface">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="flex h-topbar shrink-0 items-center gap-3 border-b border-border bg-surface px-3">
        <span className="flex items-center gap-2 font-heading text-[15px] font-semibold md:w-[260px]">
          <Icon name="table" size={18} />
          Sheetbase{' '}
          <span className="font-sans text-body font-normal text-fg-muted">
            Client portal
          </span>
        </span>
        <span className="min-w-0 flex-1 truncate text-body text-fg-muted max-md:text-label">
          {client
            ? `${client.clientName} · shared by your CDMO team`
            : 'Shared by your CDMO team'}
        </span>
        <span className="text-label text-fg-muted">{context.user.name}</span>
      </header>
      <div className="flex min-h-0 flex-1 max-lg:flex-col">
        <nav
          aria-label="Portal"
          className="hidden w-[220px] shrink-0 flex-col gap-px border-r border-border p-2.5 lg:flex"
        >
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              aria-current={tab === t ? 'page' : undefined}
              onClick={() => setTab(t)}
              className={
                tab === t
                  ? 'flex h-[30px] cursor-pointer items-center gap-2 rounded-md border-0 bg-selection px-2 text-body font-medium text-fg'
                  : 'flex h-[30px] cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-2 text-body text-fg hover:bg-surface-hover'
              }
            >
              <Icon name={tabIcon[t]} size={16} />
              {tabLabel[t]}
            </button>
          ))}
          <div className="flex-1" />
          <Muted className="px-2 pb-2">
            You see records only after your CDMO team approves and shares them.
          </Muted>
        </nav>
        <nav
          aria-label="Portal sections"
          className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-border px-4 py-2 [scrollbar-width:none] lg:hidden"
        >
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              aria-current={tab === t ? 'page' : undefined}
              onClick={() => setTab(t)}
              className={
                tab === t
                  ? 'inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-selection-border bg-selection px-3.5 text-body font-medium text-fg'
                  : 'inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-transparent px-3.5 text-body text-fg'
              }
            >
              {tabLabel[t]}
            </button>
          ))}
        </nav>

        <main id="main" className="min-h-0 min-w-0 flex-1 overflow-auto">
          {tab === 'projects' ? (
            <div className="flex flex-col gap-3 p-4 md:p-6">
              <h1 className="text-title max-md:text-[18px]">Projects</h1>
              {projects.isLoading ? (
                <Muted>Loading…</Muted>
              ) : (projects.data ?? []).length ? (
                <TableBox className="max-w-[900px]">
                  <Table aria-label="Portal projects">
                    <TableHeader>
                      <TableRow>
                        <TableHead>ID</TableHead>
                        <TableHead>Project</TableHead>
                        <TableHead>Stage</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(projects.data ?? []).map((p) => (
                        <TableRow key={p.projectId}>
                          <TableCell className="mono">
                            {p.displayId ?? p.projectId.slice(0, 8)}
                          </TableCell>
                          <TableCell className="font-medium">
                            {p.title}
                          </TableCell>
                          <TableCell>{p.stage ?? '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableBox>
              ) : (
                <EmptyState
                  icon="folder"
                  title="No shared projects yet"
                  body="Your CDMO team shares projects with your portal when they are ready."
                />
              )}
            </div>
          ) : tab === 'reports' ? (
            <div className="flex flex-col gap-3 p-4 md:p-6">
              <h1 className="text-title max-md:text-[18px]">Shared records</h1>
              {records.isLoading ? (
                <Muted>Loading…</Muted>
              ) : (records.data ?? []).length ? (
                <TableBox className="max-w-[900px]">
                  <Table aria-label="Shared records">
                    <TableHeader>
                      <TableRow>
                        <TableHead>ID</TableHead>
                        <TableHead>Record</TableHead>
                        <TableHead>Kind</TableHead>
                        <TableHead>Shared</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(records.data ?? []).map((r) => (
                        <TableRow key={r.recordId}>
                          <TableCell className="mono">{r.identifier}</TableCell>
                          <TableCell className="font-medium">
                            {r.title}
                          </TableCell>
                          <TableCell>{r.kind}</TableCell>
                          <TableCell className="text-fg-muted">
                            {r.sharedAt.slice(0, 10)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableBox>
              ) : (
                <EmptyState
                  icon="protocol"
                  title="No shared records yet"
                  body="Approved records appear here once your CDMO team shares them."
                />
              )}
            </div>
          ) : (
            <div className="flex max-w-[720px] flex-col gap-3 p-4 md:p-6">
              <h1 className="text-title max-md:text-[18px]">Messages</h1>
              {messages.isLoading ? (
                <Muted>Loading…</Muted>
              ) : (messages.data ?? []).length ? (
                <ul className="m-0 flex list-none flex-col gap-3 p-0">
                  {(messages.data ?? []).map((m) => (
                    <li
                      key={m.id}
                      className="flex flex-col gap-1 rounded-md border border-border p-3"
                    >
                      <div className="flex items-center gap-2 text-label text-fg-muted">
                        <b className="font-medium text-fg">
                          {m.authorKind === 'team' ? 'CDMO team' : 'You'}
                        </b>
                        <span>
                          {m.createdAt.slice(0, 16).replace('T', ' ')}
                        </span>
                      </div>
                      <p className="m-0 whitespace-pre-wrap text-body">
                        {m.body}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  icon="inbox"
                  title="No messages yet"
                  body="Send your CDMO team a message; the thread is shared with your project team only."
                />
              )}
              {isClient ? (
                <div className="flex flex-col gap-2">
                  <Textarea
                    rows={3}
                    value={draft}
                    aria-label="Message your CDMO team"
                    placeholder="Write a message to your CDMO team"
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  {send.isError ? (
                    <p role="alert" className="m-0 text-label text-danger-text">
                      {send.error instanceof Error
                        ? send.error.message
                        : 'Could not send the message.'}
                    </p>
                  ) : null}
                  <div className="flex items-center gap-2">
                    <Button
                      variant="primary"
                      disabled={!draft.trim() || send.isPending}
                      onClick={() => send.mutate()}
                    >
                      Send
                    </Button>
                    <Muted className="flex items-center gap-2">
                      <Status tone="review">
                        Shared with your project team only
                      </Status>
                    </Muted>
                  </div>
                </div>
              ) : (
                <Muted>
                  Messaging is for client portal accounts. Internal members use
                  the project&rsquo;s own threads.
                </Muted>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
