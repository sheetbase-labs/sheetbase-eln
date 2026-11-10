import { useState } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import { useLabLogoVersion } from '#/components/ui/lab-logo'
import { labLogoUrl } from '#/lib/lab-logo'
import { Status } from '#/components/ui/status'
import type { Tone } from '#/components/ui/status'
import {
  DescriptionList,
  Muted,
  PageHeader,
  Section,
} from '#/components/ui/layout'
import { EmptyState } from '#/components/ui/empty-state'
import { TableBox } from '#/components/ui/table'
import {
  RegistryGrid,
  rightAligned,
} from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { Button, buttonVariants } from '#/components/ui/button'
import { Icon } from '#/components/icons'
import { Tabs } from '#/components/ui/tabs'
import { Textarea } from '#/components/inventory/list'
import { cn } from '#/lib/utils'
import { now } from '#/lib/clock'
import { daysUntilDate } from '#/lib/calendar-days'
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
import type {
  ClientPortalMessage,
  ClientPortalMilestone,
  ClientPortalProject,
  ClientPortalRecord,
  ClientPortalReport,
} from '#/lib/client-portal'
import { WORKSPACE_ROLE_LABELS } from '#/lib/workspace-admin'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { authClient } from '#/lib/auth-client'
import { t } from '#/copy'

const tabs = ['projects', 'reports', 'messages'] as const

type PortalTab = (typeof tabs)[number]

/** UI port (roadmap-4/ui-app3): the client portal (ADR-0049). A client viewer
 * sees only approved records explicitly shared to their client, read through
 * the portal RPCs — there is no app shell and no internal read access. The
 * shell mirrors `canvas/ClientPortal.dc.html`: Projects (milestones and
 * approved records), Reports, Messages, the CDMO message and the access
 * explanation. PDFs are serialised by the guarded byte route.
 *
 * Each section is a URL: `?tab=` selects it, so a portal section can be
 * linked, reloaded and reached with the browser's Back button. */
/** The one search field the portal reads; anything else in the URL is ignored. */
const portalSearch = z.object({ tab: z.enum(tabs).optional() })

export const Route = createFileRoute('/client-portal')({
  validateSearch: (search) => {
    const decoded = portalSearch.safeParse(search)

    return decoded.success ? decoded.data : {}
  },
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth

    if (!context) {
      throw redirect(signInRedirect(location))
    }

    return { context }
  },
  component: ClientPortal,
})

const tabLabel: Record<PortalTab, string> = {
  projects: t('projects.clientPortal.tabs.projects'),
  reports: t('projects.clientPortal.tabs.reports'),
  messages: t('projects.clientPortal.tabs.messages'),
}

const tabIcon: Record<PortalTab, 'folder' | 'protocol' | 'inbox'> = {
  projects: 'folder',
  reports: 'protocol',
  messages: 'inbox',
}

/** The readable name of every workspace role, by the role key the database stores. */
const ROLE_LABELS = new Map<string, string>(
  Object.entries(WORKSPACE_ROLE_LABELS),
)

/** How one project or milestone status is painted and named. */
interface PortalStatus {
  tone: Tone
  label: string
}

const PROJECT_STATUS = new Map<string, PortalStatus>([
  [
    'active',
    { tone: 'progress', label: t('projects.clientPortal.status.active') },
  ],
  [
    'in_progress',
    { tone: 'progress', label: t('projects.clientPortal.status.inProgress') },
  ],
  [
    'in_review',
    { tone: 'review', label: t('projects.clientPortal.status.inReview') },
  ],
  [
    'complete',
    { tone: 'ok', label: t('projects.clientPortal.status.complete') },
  ],
  [
    'on_hold',
    { tone: 'warn', label: t('projects.clientPortal.status.onHold') },
  ],
  [
    'archived',
    { tone: 'none', label: t('projects.clientPortal.status.archived') },
  ],
])

const MILESTONE_STATUS = new Map<string, PortalStatus>([
  // The project page calls these Planned and Delivered; so does the portal.
  [
    'not_started',
    {
      tone: 'draft',
      label: t('projects.clientPortal.milestoneStatus.planned'),
    },
  ],
  [
    'in_progress',
    { tone: 'progress', label: t('projects.clientPortal.status.inProgress') },
  ],
  [
    'completed',
    { tone: 'ok', label: t('projects.clientPortal.milestoneStatus.delivered') },
  ],
  [
    'blocked',
    { tone: 'bad', label: t('projects.clientPortal.milestoneStatus.blocked') },
  ],
  [
    'cancelled',
    {
      tone: 'none',
      label: t('projects.clientPortal.milestoneStatus.cancelled'),
    },
  ],
])

/** The project page calls a milestone past its date and not done Overdue; so does the portal. */
function portalMilestoneState(
  status: string,
  dueAt: string | null,
): PortalStatus {
  if (status !== 'completed' && status !== 'cancelled' && dueAt) {
    const days = daysUntilDate(dueAt, now())

    if (days !== null && days < 0)
      return {
        tone: 'bad',
        label: t('projects.clientPortal.milestoneStatus.overdue'),
      }
  }

  return MILESTONE_STATUS.get(status) ?? withFallback(status)
}

function withFallback(status: string): PortalStatus {
  return { tone: 'none', label: status.replace(/_/g, ' ') }
}

const portalMilestoneColumns: RegistryColumn<ClientPortalMilestone>[] = [
  {
    id: 'milestone',
    header: t('projects.clientPortal.milestone'),
    meta: { headerClassName: 'pl-2.5!', cellClassName: 'pl-2.5!' },
    cell: ({ row }) => row.original.title,
  },
  {
    id: 'status',
    header: t('projects.clientPortal.statusHeader'),
    cell: ({ row }) => {
      const state = portalMilestoneState(
        row.original.status,
        row.original.dueAt,
      )

      return (
        <span
          className={cn(
            row.original.status === 'not_started' && 'text-fg-muted',
          )}
        >
          <Status tone={state.tone}>{state.label}</Status>
        </span>
      )
    },
  },
  {
    id: 'target',
    header: t('projects.clientPortal.target'),
    meta: { cellClassName: 'text-fg-muted' },
    cell: ({ row }) => formatPortalDate(row.original.dueAt),
  },
]

const portalRecordColumns: RegistryColumn<ClientPortalRecord>[] = [
  {
    id: 'record',
    header: t('projects.clientPortal.record'),
    meta: {
      headerClassName: 'pl-2.5!',
      cellClassName: 'pl-2.5! mono',
    },
    cell: ({ row }) => row.original.identifier,
  },
  {
    id: 'title',
    header: t('projects.clientPortal.titleHeader'),
    cell: ({ row }) => row.original.title,
  },
  {
    id: 'approved',
    header: t('projects.clientPortal.approved'),
    cell: ({ row }) =>
      row.original.approvedAt
        ? `${formatPortalDate(row.original.approvedAt)}${
            row.original.approvedByName
              ? t('projects.clientPortal.approvedBy', {
                  name: row.original.approvedByName,
                })
              : ''
          }`
        : '—',
  },
  {
    id: 'shared',
    header: t('projects.clientPortal.sharedHeader'),
    meta: { cellClassName: 'text-fg-muted' },
    cell: ({ row }) => formatPortalDate(row.original.sharedAt),
  },
  {
    id: 'actions',
    header: '',
    meta: rightAligned<ClientPortalRecord>().meta,
    cell: ({ row }) => (
      <a
        className={buttonVariants({ size: 'sm' })}
        href={`/api/client-portal/records/${row.original.recordId}/pdf`}
      >
        {t('projects.clientPortal.openPdf')}
      </a>
    ),
  },
]

const portalReportColumns: RegistryColumn<ClientPortalReport>[] = [
  {
    id: 'report',
    header: t('projects.clientPortal.report'),
    meta: { headerClassName: 'pl-2.5!', cellClassName: 'pl-2.5!' },
    cell: ({ row }) => row.original.title,
  },
  {
    id: 'covers',
    header: t('projects.clientPortal.covers'),
    cell: ({ row }) => row.original.covers ?? '—',
  },
  {
    id: 'shared',
    header: t('projects.clientPortal.sharedHeader'),
    meta: { cellClassName: 'text-fg-muted' },
    cell: ({ row }) => formatPortalDate(row.original.sharedAt),
  },
  {
    id: 'actions',
    header: '',
    meta: rightAligned<ClientPortalReport>().meta,
    cell: ({ row }) => (
      <a
        className={buttonVariants({ size: 'sm' })}
        href={`/api/client-portal/records/${row.original.recordId}/pdf`}
      >
        {t('projects.clientPortal.openPdf')}
      </a>
    ),
  },
]

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
    PROJECT_STATUS.get(project.status) ?? withFallback(project.status)

  return (
    <div className="flex flex-col">
      <PageHeader
        className="px-8 pt-4 pb-3 md:px-8 md:pt-4"
        title={project.title}
        titleLevel={2}
        meta={
          <>
            <Status tone={projectStatus.tone}>{projectStatus.label}</Status>
            {project.stage ? <span>{project.stage}</span> : null}
            {project.leadName ? (
              <span>
                {t('projects.clientPortal.lead', { name: project.leadName })}
              </span>
            ) : null}
            {project.lastUpdate ? (
              <span>
                {t('projects.clientPortal.lastUpdate', {
                  date: formatPortalDate(project.lastUpdate),
                })}
              </span>
            ) : null}
          </>
        }
      />
      <div className="flex flex-col gap-6 px-8 py-[22px]">
        <Section title={t('projects.clientPortal.milestones')}>
          {milestones.isPending ? (
            <Muted>{t('common.states.loading')}</Muted>
          ) : (milestones.data ?? []).length ? (
            <TableBox>
              <RegistryGrid
                label={t('projects.clientPortal.projectMilestones')}
                rows={milestones.data ?? []}
                columns={portalMilestoneColumns}
                getRowId={(milestone) => milestone.milestoneId}
                selectable={false}
              />
            </TableBox>
          ) : (
            <Muted>{t('projects.clientPortal.noMilestones')}</Muted>
          )}
        </Section>
        <Section
          title={t('projects.clientPortal.approvedRecords')}
          count={approved.length}
        >
          {approved.length ? (
            <TableBox>
              <RegistryGrid
                label={t('projects.clientPortal.approvedShared')}
                rows={approved}
                columns={portalRecordColumns}
                getRowId={(record) => record.recordId}
                selectable={false}
              />
            </TableBox>
          ) : (
            <EmptyState
              icon="table"
              title={t('projects.clientPortal.noRecords.title')}
              description={t('projects.clientPortal.noRecords.body')}
            />
          )}
          <Muted className="text-[12px]">
            {t('projects.clientPortal.pdfNote')}
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
      <Section
        title={t('projects.clientPortal.tabs.reports')}
        count={(reports.data ?? []).length}
      >
        {reports.isPending ? (
          <Muted>{t('common.states.loading')}</Muted>
        ) : (reports.data ?? []).length ? (
          <TableBox>
            <RegistryGrid
              label={t('projects.clientPortal.sharedReports')}
              rows={reports.data ?? []}
              columns={portalReportColumns}
              getRowId={(report) => report.recordId}
              selectable={false}
            />
          </TableBox>
        ) : (
          <EmptyState
            icon="protocol"
            title={t('projects.clientPortal.noReports.title')}
            description={t('projects.clientPortal.noReports.body')}
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
    <div className="flex flex-col gap-4 px-8 py-[22px]">
      <Section
        title={t('projects.clientPortal.tabs.messages')}
        count={(messages.data ?? []).length}
      >
        {messages.isPending ? (
          <Muted>{t('common.states.loading')}</Muted>
        ) : (messages.data ?? []).length ? (
          <div className="flex flex-col gap-3 text-body">
            {(messages.data ?? []).map((m) => (
              <div key={m.id} className="rounded-md border border-border p-3">
                <b className="font-medium">
                  {m.authorKind === 'team'
                    ? (m.authorName ?? t('projects.clientPortal.team'))
                    : t('projects.schedulePage.you')}
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
            title={t('projects.clientPortal.noMessages.title')}
            description={t('projects.clientPortal.noMessages.body')}
          />
        )}
      </Section>
      {isClient ? (
        <div className="flex flex-col gap-2">
          <Textarea
            rows={3}
            value={draft}
            aria-label={t('projects.clientPortal.messageLabel')}
            placeholder={t('projects.clientPortal.messagePlaceholder')}
            onChange={(e) => setDraft(e.target.value)}
          />
          {send.isError ? (
            <p role="alert" className="m-0 text-label text-danger-text">
              {send.error instanceof Error
                ? send.error.message
                : t('projects.clientPortal.sendFailed')}
            </p>
          ) : null}
          <div>
            <Button
              variant="primary"
              disabled={!draft.trim() || send.isPending}
              onClick={() => send.mutate()}
            >
              {t('projects.clientPortal.send')}
            </Button>
          </div>
        </div>
      ) : (
        <Muted>{t('projects.clientPortal.internalNote')}</Muted>
      )}
    </div>
  )
}

/** The lab's logo in the portal's top bar; the table icon when it has none. */
function PortalMark() {
  const version = useLabLogoVersion()

  return version ? (
    <img
      src={labLogoUrl(version)}
      alt=""
      style={{ height: 22 }}
      className="w-auto max-w-[140px] object-contain"
    />
  ) : (
    <Icon name="table" size={18} />
  )
}

/** Signing out of the portal: clear the session, the cache, then leave. */
function usePortalSignOut({
  navigate,
  router,
}: {
  navigate: ReturnType<typeof Route.useNavigate>
  router: ReturnType<typeof useRouter>
}) {
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)

  async function signOut() {
    setSignOutError(null)
    setSigningOut(true)

    try {
      const result = await authClient.signOut()

      if (result.error || !result.data.success) throw new Error('sign out')
      await router.options.context.queryClient.cancelQueries()
      router.options.context.queryClient.clear()
      // react-doctor-disable-next-line react-doctor/tanstack-start-no-navigate-in-render -- This is the sign-out handler's own call, made after the awaited sign-out, not during render.
      await navigate({ to: '/sign-in', search: { state: 'signed-out' } })
      await router.invalidate()
    } catch {
      setSignOutError(t('projects.clientPortal.signOutFailed'))
    } finally {
      setSigningOut(false)
    }
  }

  return { signingOut, signOutError, signOut }
}

/** What the selected section shows: projects, reports or messages. */
function PortalMain({
  tab,
  projects,
  isClient,
}: {
  tab: PortalTab
  projects: UseQueryResult<ClientPortalProject[]>
  isClient: boolean
}) {
  return (
    <main id="main" className="min-h-0 min-w-0 flex-1 overflow-auto">
      {tab === 'projects' ? (
        projects.isPending ? (
          // Placeholder chrome only: the page's single H1 sits in the
          // topbar, so the loading state must not emit an empty one.
          <div
            aria-hidden="true"
            className="border-b border-border bg-surface px-4 pt-3 pb-3 md:px-6 md:pt-3.5"
          />
        ) : (projects.data ?? []).length ? (
          (projects.data ?? []).map((p) => (
            <PortalProjectPanel key={p.projectId} project={p} />
          ))
        ) : (
          <div className="px-8 py-6">
            <EmptyState
              icon="folder"
              title={t('projects.clientPortal.noProjects.title')}
              description={t('projects.clientPortal.noProjects.body')}
            />
          </div>
        )
      ) : tab === 'reports' ? (
        <PortalReports />
      ) : (
        <PortalMessages isClient={isClient} />
      )}
    </main>
  )
}

/** The portal's aside: the latest message from the lab, and what access means. */
function PortalAside({
  latestTeamMessage,
  isClient,
  isClientAccount,
  roleLabel,
  onMessages,
}: {
  latestTeamMessage: ClientPortalMessage | undefined
  isClient: boolean
  isClientAccount: boolean
  roleLabel: string
  onMessages: () => void
}) {
  return (
    <aside className="hidden w-[300px] shrink-0 flex-col gap-4 overflow-auto border-l border-border bg-surface p-4 xl:flex">
      <section>
        <h3 className="mb-1.5 font-sans text-label font-semibold">
          {t('projects.clientPortal.messageFrom')}
        </h3>
        {latestTeamMessage ? (
          <div className="text-label leading-[18px]">
            <b className="font-medium">
              {latestTeamMessage.authorName ?? t('projects.clientPortal.team')}
            </b>{' '}
            <span className="text-fg-muted">
              {t('projects.clientPortal.messageDay', {
                day: formatPortalDay(latestTeamMessage.createdAt),
              })}
            </span>
            <div>{latestTeamMessage.body}</div>
          </div>
        ) : (
          <Muted>{t('projects.clientPortal.noMessages.short')}</Muted>
        )}
        {isClient ? (
          <Button size="sm" className="mt-2" onClick={onMessages}>
            {t('projects.clientPortal.reply')}
          </Button>
        ) : null}
      </section>
      <section>
        <h3 className="mb-1.5 font-sans text-label font-semibold">
          {isClientAccount
            ? t('projects.clientPortal.access.title')
            : t('projects.clientPortal.previewFull')}
        </h3>
        {isClientAccount ? (
          <DescriptionList
            items={[
              [
                t('projects.clientPortal.access.role'),
                t('projects.clientPortal.access.viewer'),
              ],
              [
                t('projects.clientPortal.access.can'),
                t('projects.clientPortal.access.canBody'),
              ],
              [
                t('projects.clientPortal.access.cant'),
                t('projects.clientPortal.access.cantBody'),
              ],
            ]}
          />
        ) : (
          <>
            <DescriptionList
              items={[
                [t('projects.clientPortal.access.yourRole'), roleLabel],
                [
                  t('projects.clientPortal.access.thisView'),
                  t('projects.clientPortal.access.thisViewBody'),
                ],
              ]}
            />
            <Muted className="mt-2">
              {t('projects.clientPortal.access.previewNote')}
            </Muted>
          </>
        )}
      </section>
    </aside>
  )
}

/** The portal's section links, with how much each holds. */
function PortalNav({
  tab,
  counts,
  onTab,
}: {
  tab: PortalTab
  counts: Record<PortalTab, number | null>
  onTab: (tab: PortalTab) => void
}) {
  return (
    <nav
      aria-label={t('projects.clientPortal.portal')}
      className="hidden w-[232px] shrink-0 flex-col gap-px border-r border-border p-2.5 lg:flex"
    >
      {tabs.map((name) => (
        <button
          key={name}
          type="button"
          aria-current={tab === name ? 'page' : undefined}
          onClick={() => onTab(name)}
          className={
            tab === name
              ? 'flex h-[30px] cursor-pointer items-center gap-2 rounded-md border-0 bg-selection px-2 text-body font-medium text-fg'
              : 'flex h-[30px] cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-2 text-body text-fg hover:bg-surface-hover'
          }
        >
          <Icon name={tabIcon[name]} size={16} />
          {tabLabel[name]}
          {counts[name] != null ? (
            <span className="ml-auto text-label text-fg-muted">
              {counts[name]}
            </span>
          ) : null}
        </button>
      ))}
      <div className="flex-1" />
      <Muted className="px-2 pb-2">
        {t('projects.clientPortal.sidebarNote')}
      </Muted>
    </nav>
  )
}

/** The portal's topbar: brand, whose portal it is, the preview mark, and sign-out. */
function PortalHeader({
  clientCode,
  userName,
  initials,
  isClientAccount,
  signingOut,
  signOutError,
  onSignOut,
}: {
  clientCode: string | null
  userName: string
  initials: string
  isClientAccount: boolean
  signingOut: boolean
  signOutError: string | null
  onSignOut: () => void
}) {
  return (
    <header className="flex h-topbar shrink-0 items-center gap-3 border-b border-border bg-surface px-3">
      <div className="flex items-center gap-2 font-heading text-[15px] font-semibold md:w-[260px]">
        <PortalMark />
        {t('projects.clientPortal.brand')}{' '}
        {/* The portal is a standalone viewer route with no `PageHeader`, so
          the topbar carries the page's only heading. */}
        <h1 className="font-sans text-body font-normal text-fg-muted">
          {t('projects.clientPortal.title')}
        </h1>
      </div>
      <span className="min-w-0 flex-1 truncate text-body text-fg-muted max-md:text-label">
        {clientCode
          ? t('projects.clientPortal.sharedWithCode', { code: clientCode })
          : t('projects.clientPortal.sharedByCdmo')}
      </span>
      {isClientAccount ? null : (
        <span className="shrink-0 whitespace-nowrap rounded-full border border-border bg-surface-muted px-2 py-0.5 text-caption text-fg-muted">
          {/* Short visual label on a phone, the full label for assistive
            tech and on wider frames. */}
          <span aria-hidden="true" className="md:hidden">
            {t('projects.clientPortal.preview')}
          </span>
          <span className="max-md:sr-only">
            {t('projects.clientPortal.previewFull')}
          </span>
        </span>
      )}
      <Button
        size="sm"
        variant="quiet"
        disabled={signingOut}
        onClick={onSignOut}
      >
        {t('projects.clientPortal.signOut')}
      </Button>
      {signOutError ? (
        <span role="alert" className="text-label text-danger-text">
          {signOutError}
        </span>
      ) : null}
      <span
        aria-label={t('projects.clientPortal.account', {
          name: userName,
        })}
        className="flex size-7 items-center justify-center rounded-full bg-review-wash text-[11px] font-semibold"
      >
        {initials}
      </span>
    </header>
  )
}

function ClientPortal() {
  const { context } = Route.useRouteContext()
  const navigate = Route.useNavigate()
  const search = Route.useSearch()
  const router = useRouter()

  const { signingOut, signOutError, signOut } = usePortalSignOut({
    navigate,
    router,
  })

  const tab = search.tab ?? 'projects'
  const setTab = (next: PortalTab) => void navigate({ search: { tab: next } })

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
  // The portal is reachable by any signed-in member, so the account's own role
  // comes from the session, not from the page: only a `client_viewer` is a
  // client account, and everyone else is looking at the client view as a
  // preview. Claiming "Client viewer" for an internal member made this page
  // disagree with /settings/workspace/members about the same account.
  const workspaceRole = context.workspace?.role ?? null
  const isClientAccount = workspaceRole === 'client_viewer'

  const roleLabel = workspaceRole
    ? (ROLE_LABELS.get(workspaceRole) ?? workspaceRole)
    : t('projects.clientPortal.noWorkspace')

  const messages = useQuery({
    queryKey: clientPortalQueryKeys.messages,
    queryFn: () => fetchClientPortalMessages(),
    enabled: isClient,
  })

  const project = projects.data?.[0]

  const latestTeamMessage = [...(messages.data ?? [])]
    .filter((m) => m.authorKind === 'team')
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .at(-1)

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
        {t('projects.clientPortal.skip')}
      </a>
      <PortalHeader
        clientCode={project?.clientCode ?? identity.data?.clientCode ?? null}
        userName={context.user.name}
        initials={initials}
        isClientAccount={isClientAccount}
        signingOut={signingOut}
        signOutError={signOutError}
        onSignOut={() => void signOut()}
      />
      <div className="flex min-h-0 flex-1 max-lg:flex-col">
        <PortalNav tab={tab} counts={counts} onTab={setTab} />
        <Tabs
          mode="state"
          variant="chip"
          label={t('projects.clientPortal.sections')}
          className="shrink-0 border-b border-border px-4 py-2 lg:hidden"
          value={tab}
          onValueChange={(next) => {
            const chosen = tabs.find((key) => key === next)

            if (chosen) setTab(chosen)
          }}
          items={tabs.map((key) => ({
            key,
            label: tabLabel[key],
          }))}
        />

        <PortalMain tab={tab} projects={projects} isClient={isClient} />

        <PortalAside
          latestTeamMessage={latestTeamMessage}
          isClient={isClient}
          isClientAccount={isClientAccount}
          roleLabel={roleLabel}
          onMessages={() => setTab('messages')}
        />
      </div>
    </div>
  )
}
