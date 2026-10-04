import { useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import {
  DescriptionList,
  Muted,
  PageHeader,
  Section,
} from '#/components/v3/ui/layout'
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
import { Button, buttonVariants } from '#/components/v3/ui/button'
import { Icon } from '#/components/v3/icons'
import { Textarea } from '#/components/v3/inventory/list'
import { cn } from '#/lib/utils'
import {
  clientPortalQueryKeys,
  fetchClientPortalIdentity,
  fetchClientPortalMessages,
  fetchClientPortalMilestones,
  fetchClientPortalProjects,
  fetchClientPortalRecords,
  fetchClientPortalReports,
  formatPortalDate,
  formatPortalDay,
  postClientPortalMessage,
} from '#/lib/client-portal'
import type { ClientPortalProject } from '#/lib/client-portal'

/** UI port (roadmap-4/ui-app3): the client portal (ADR-0049). A client viewer
 * sees only approved records explicitly shared to their client, read through
 * the portal RPCs — there is no app shell and no internal read access. The
 * shell mirrors `canvas/ClientPortal.dc.html`: Projects (milestones and
 * approved records), Reports, Messages, the CDMO message and the access
 * explanation. PDFs are serialised by the guarded byte route. */
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

const PROJECT_STATUS: Record<string, { tone: Tone; label: string }> = {
  active: { tone: 'progress', label: 'Active' },
  in_progress: { tone: 'progress', label: 'In progress' },
  in_review: { tone: 'review', label: 'In review' },
  complete: { tone: 'ok', label: 'Complete' },
  on_hold: { tone: 'warn', label: 'On hold' },
  archived: { tone: 'none', label: 'Archived' },
}

const MILESTONE_STATUS: Record<string, { tone: Tone; label: string }> = {
  not_started: { tone: 'none', label: 'Not started' },
  in_progress: { tone: 'progress', label: 'In progress' },
  completed: { tone: 'ok', label: 'Complete' },
  blocked: { tone: 'bad', label: 'Blocked' },
  cancelled: { tone: 'none', label: 'Cancelled' },
}

function withFallback(status: string): { tone: Tone; label: string } {
  return { tone: 'none', label: status.replace(/_/g, ' ') }
}

function PortalProjectPanel({ project }: { project: ClientPortalProject }) {
  const milestones = useQuery({
    queryKey: clientPortalQueryKeys.milestones(project.projectId),
    queryFn: () => fetchClientPortalMilestones(project.projectId),
  })
  const records = useQuery({
    queryKey: clientPortalQueryKeys.records,
    queryFn: () => fetchClientPortalRecords(),
  })
  const approved = (records.data ?? []).filter(
    (r) => r.projectId === project.projectId && r.kind !== 'report',
  )
  const projectStatus =
    PROJECT_STATUS[project.status] ?? withFallback(project.status)

  return (
    <div className="flex flex-col">
      <PageHeader
        className="px-8 pt-4 pb-3 md:px-8 md:pt-4"
        title={project.title}
        meta={
          <>
            <Status tone={projectStatus.tone}>{projectStatus.label}</Status>
            {project.stage ? <span>{project.stage}</span> : null}
            {project.leadName ? (
              <span>CDMO lead {project.leadName}</span>
            ) : null}
            {project.lastUpdate ? (
              <span>Last update {formatPortalDate(project.lastUpdate)}</span>
            ) : null}
          </>
        }
      />
      <div className="flex flex-col gap-6 px-8 py-[22px]">
        <Section title="Milestones">
          {milestones.isLoading ? (
            <Muted>Loading…</Muted>
          ) : (milestones.data ?? []).length ? (
            <TableBox>
              <Table aria-label="Project milestones">
                <TableHeader>
                  <TableRow>
                    <TableHead className="first:pl-2.5">Milestone</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Target</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(milestones.data ?? []).map((m) => {
                    const state =
                      MILESTONE_STATUS[m.status] ?? withFallback(m.status)
                    return (
                      <TableRow key={m.milestoneId}>
                        <TableCell className="first:pl-2.5">
                          {m.title}
                        </TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              m.status === 'not_started' && 'text-fg-muted',
                            )}
                          >
                            <Status tone={state.tone}>{state.label}</Status>
                          </span>
                        </TableCell>
                        <TableCell className="text-fg-muted">
                          {formatPortalDate(m.dueAt)}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableBox>
          ) : (
            <Muted>No milestones yet.</Muted>
          )}
        </Section>
        <Section title="Approved records" count={approved.length}>
          {approved.length ? (
            <TableBox>
              <Table aria-label="Approved shared records">
                <TableHeader>
                  <TableRow>
                    <TableHead className="first:pl-2.5">Record</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Approved</TableHead>
                    <TableHead>Shared</TableHead>
                    <TableHead align="right" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {approved.map((r) => (
                    <TableRow key={r.recordId}>
                      <TableCell className="mono first:pl-2.5">
                        {r.identifier}
                      </TableCell>
                      <TableCell>{r.title}</TableCell>
                      <TableCell>
                        {r.approvedAt
                          ? `${formatPortalDate(r.approvedAt)}${r.approvedByName ? ` · ${r.approvedByName}` : ''}`
                          : '—'}
                      </TableCell>
                      <TableCell className="text-fg-muted">
                        {formatPortalDate(r.sharedAt)}
                      </TableCell>
                      <TableCell align="right">
                        <a
                          className={buttonVariants({ size: 'sm' })}
                          href={`/api/client-portal/records/${r.recordId}/pdf`}
                        >
                          Open PDF
                        </a>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableBox>
          ) : (
            <EmptyState
              icon="table"
              title="No approved records yet"
              body="Approved items appear here once your CDMO team shares them."
            />
          )}
          <Muted className="text-[12px]">
            Each PDF includes the signature page and a verification code you can
            check against the CDMO&rsquo;s audit trail.
          </Muted>
        </Section>
      </div>
    </div>
  )
}

function PortalReports() {
  const reports = useQuery({
    queryKey: clientPortalQueryKeys.reports,
    queryFn: () => fetchClientPortalReports(),
  })
  return (
    <div className="flex flex-col gap-6 px-8 py-[22px]">
      <Section title="Reports" count={(reports.data ?? []).length}>
        {reports.isLoading ? (
          <Muted>Loading…</Muted>
        ) : (reports.data ?? []).length ? (
          <TableBox>
            <Table aria-label="Shared reports">
              <TableHeader>
                <TableRow>
                  <TableHead className="first:pl-2.5">Report</TableHead>
                  <TableHead>Covers</TableHead>
                  <TableHead>Shared</TableHead>
                  <TableHead align="right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(reports.data ?? []).map((r) => (
                  <TableRow key={r.recordId}>
                    <TableCell className="first:pl-2.5">{r.title}</TableCell>
                    <TableCell>{r.covers ?? '—'}</TableCell>
                    <TableCell className="text-fg-muted">
                      {formatPortalDate(r.sharedAt)}
                    </TableCell>
                    <TableCell align="right">
                      <a
                        className={buttonVariants({ size: 'sm' })}
                        href={`/api/client-portal/records/${r.recordId}/pdf`}
                      >
                        Open PDF
                      </a>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableBox>
        ) : (
          <EmptyState
            icon="protocol"
            title="No shared reports yet"
            body="Approved reports appear here once your CDMO team shares them."
          />
        )}
      </Section>
    </div>
  )
}

function PortalMessages({ isClient }: { isClient: boolean }) {
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
  return (
    <div className="flex max-w-[720px] flex-col gap-4 px-8 py-[22px]">
      <Section title="Messages" count={(messages.data ?? []).length}>
        {messages.isLoading ? (
          <Muted>Loading…</Muted>
        ) : (messages.data ?? []).length ? (
          <div className="flex flex-col gap-3 text-body">
            {(messages.data ?? []).map((m) => (
              <div key={m.id} className="rounded-md border border-border p-3">
                <b className="font-medium">
                  {m.authorKind === 'team'
                    ? (m.authorName ?? 'CDMO team')
                    : 'You'}
                </b>{' '}
                <span className="text-fg-muted">
                  {formatPortalDay(m.createdAt)}
                </span>
                <div className="mt-1 whitespace-pre-wrap">{m.body}</div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon="inbox"
            title="No messages yet"
            body="Send your CDMO team a message; the thread is shared with your project team only."
          />
        )}
      </Section>
      {isClient ? (
        <div className="flex flex-col gap-2">
          <Textarea
            rows={3}
            value={draft}
            aria-label="Message your CDMO team"
            placeholder="Write to your CDMO team"
            onChange={(e) => setDraft(e.target.value)}
          />
          {send.isError ? (
            <p role="alert" className="m-0 text-label text-danger-text">
              {send.error instanceof Error
                ? send.error.message
                : 'Could not send the message.'}
            </p>
          ) : null}
          <div>
            <Button
              variant="primary"
              disabled={!draft.trim() || send.isPending}
              onClick={() => send.mutate()}
            >
              Send
            </Button>
          </div>
        </div>
      ) : (
        <Muted>
          Messaging is for client portal accounts. Internal members use the
          project&rsquo;s own threads.
        </Muted>
      )}
    </div>
  )
}

function ClientPortal() {
  const { context } = Route.useRouteContext()
  const [tab, setTab] = useState<PortalTab>('projects')
  const projects = useQuery({
    queryKey: clientPortalQueryKeys.projects,
    queryFn: () => fetchClientPortalProjects(),
  })
  const reports = useQuery({
    queryKey: clientPortalQueryKeys.reports,
    queryFn: () => fetchClientPortalReports(),
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
  const project = projects.data?.[0]
  const latestTeamMessage = [...(messages.data ?? [])]
    .reverse()
    .find((m) => m.authorKind === 'team')
  const initials = context.user.name
    .split(/\s+/)
    .filter((word) => /^[A-Za-z]/.test(word))
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('')
  const counts: Record<PortalTab, number | null> = {
    projects: null,
    reports: reports.data?.length ?? null,
    messages: messages.data?.length ?? null,
  }

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
          {(project?.clientCode ?? identity.data?.clientCode)
            ? `${project?.clientCode ?? identity.data?.clientCode} · shared by your CDMO team`
            : 'Shared by your CDMO team'}
        </span>
        <span
          aria-label={`Account: ${context.user.name}`}
          className="flex size-7 items-center justify-center rounded-full bg-review-wash text-[11px] font-semibold"
        >
          {initials}
        </span>
      </header>
      <div className="flex min-h-0 flex-1 max-lg:flex-col">
        <nav
          aria-label="Portal"
          className="hidden w-[232px] shrink-0 flex-col gap-px border-r border-border p-2.5 lg:flex"
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
              {counts[t] != null ? (
                <span className="ml-auto text-label text-fg-muted">
                  {counts[t]}
                </span>
              ) : null}
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
            projects.isLoading ? (
              <PageHeader title="" />
            ) : (projects.data ?? []).length ? (
              (projects.data ?? []).map((p) => (
                <PortalProjectPanel key={p.projectId} project={p} />
              ))
            ) : (
              <div className="px-8 py-6">
                <EmptyState
                  icon="folder"
                  title="No shared projects yet"
                  body="Your CDMO team shares projects with your portal when they are ready."
                />
              </div>
            )
          ) : tab === 'reports' ? (
            <PortalReports />
          ) : (
            <PortalMessages isClient={isClient} />
          )}
        </main>

        <aside className="hidden w-[300px] shrink-0 flex-col gap-4 overflow-auto border-l border-border bg-surface p-4 xl:flex">
          <section>
            <h3 className="mb-1.5 font-sans text-label font-semibold">
              Message from your CDMO
            </h3>
            {latestTeamMessage ? (
              <div className="text-label leading-[18px]">
                <b className="font-medium">
                  {latestTeamMessage.authorName ?? 'CDMO team'}
                </b>{' '}
                <span className="text-fg-muted">
                  · {formatPortalDay(latestTeamMessage.createdAt)}
                </span>
                <div>{latestTeamMessage.body}</div>
              </div>
            ) : (
              <Muted>No messages yet.</Muted>
            )}
            <Button
              size="sm"
              className="mt-2"
              onClick={() => setTab('messages')}
            >
              Reply
            </Button>
          </section>
          <section>
            <h3 className="mb-1.5 font-sans text-label font-semibold">
              Your access
            </h3>
            <DescriptionList
              items={[
                ['Role', 'Client viewer'],
                ['Can', 'Read and download approved records, message the team'],
                ["Can't", 'See drafts, raw data or other clients'],
              ]}
            />
          </section>
        </aside>
      </div>
    </div>
  )
}
