import { Link, Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { AskAiButton } from '#/components/assist/ask-ai-button'
import { PageHeader } from '#/components/v3/ui/layout'
import { Tabs } from '#/components/v3/ui/tabs'
import { Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import { CopyButton } from '#/components/v3/ui/copy-button'
import { BookInstrumentButton } from '#/components/v3/experiments/book-instrument-button'
import { experimentStatus } from '#/components/v3/experiments/experiments-data'
import {
  fetchProject,
  formatDate,
  notebookDataClient,
} from '#/lib/notebook-data'
import { useUserNames } from '#/lib/user-names'
import { resolveIdentifierParam } from '#/lib/identifier-resolution'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { RecordTitleInput } from '../records/$recordId/notebook'
import { ExperimentLifecycleActions } from './$expId/-lifecycle-actions'

/** The experiment page: one frame, one URL. Notebook is the default tab and the
 * working surface; Overview, Samples, Datasets, Results, Files and History sit
 * beside it. `/records/$recordId/notebook` redirects here for experiments. */
export const Route = createFileRoute('/experiments/$expId')({
  beforeLoad: async ({ context: rootContext, params, location }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect(signInRedirect(location))
    }
    await resolveIdentifierParam({
      entity: 'experiment',
      ref: params.expId,
      href: location.href,
    })
    return { context }
  },
  component: ExperimentLayout,
})

export interface RecordLinkWire {
  id: string
  target_kind: string
  target_identifier: string
  target_record_id: string | null
  link_type: string
  created_at: string
}

export const experimentQueryKeys = {
  record: (recordId: string) => ['ui-port', 'experiment', recordId] as const,
  links: (recordId: string) =>
    ['ui-port', 'experiment-links', recordId] as const,
  revisions: (recordId: string) =>
    ['ui-port', 'experiment-revisions', recordId] as const,
}

export function useExperimentRecord(recordId: string) {
  return useQuery({
    queryKey: experimentQueryKeys.record(recordId),
    queryFn: () =>
      notebookDataClient
        .list<{
          id: string
          workspace_id: string
          identifier: string
          title: string
          status: string
          project_id: string | null
          tags: string[] | null
          locked_at: string | null
          archived_at: string | null
          created_by_user_id: string
          reviewer_user_id: string | null
          planned_end: string | null
          created_at: string
          updated_at: string
        }>(
          'records',
          `?id=eq.${recordId}&kind=eq.experiment&limit=1&select=id,workspace_id,identifier,title,status,project_id,tags,locked_at,archived_at,created_by_user_id,reviewer_user_id,planned_end,created_at,updated_at`,
        )
        .then((rows) => rows[0] ?? null),
  })
}

export function useExperimentLinks(recordId: string) {
  return useQuery({
    queryKey: experimentQueryKeys.links(recordId),
    queryFn: () =>
      notebookDataClient.list<RecordLinkWire>(
        'record_links',
        `?source_record_id=eq.${recordId}&select=id,target_kind,target_identifier,target_record_id,link_type,created_at&order=created_at.desc`,
      ),
  })
}

export function experimentStatusFor(status: string): {
  tone: Tone
  label: string
} {
  return experimentStatus(status)
}

function ExperimentLayout() {
  const { expId } = Route.useParams()
  const record = useExperimentRecord(expId)
  const links = useExperimentLinks(expId)
  const { userLabel } = useUserNames(
    record.data?.created_by_user_id ? [record.data.created_by_user_id] : [],
  )
  const e = record.data
  const project = useQuery({
    queryKey: ['ui-port', 'experiment-project', e?.project_id ?? ''],
    queryFn: () =>
      e?.project_id
        ? fetchProject(notebookDataClient, e.project_id)
        : Promise.resolve(null),
    enabled: Boolean(e?.project_id),
  })

  if (!e) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          trail={[{ label: 'Experiments', link: { to: '/experiments' } }]}
          title={
            record.isLoading ? 'Loading experiment…' : 'Experiment not found'
          }
        />
      </div>
    )
  }

  const rows = links.data ?? []
  const params = { expId: e.id }
  const protocolLink = rows.find(
    (l) => l.link_type === 'protocol' && l.target_record_id,
  )
  const kindCount = (kind: string) =>
    rows.filter((l) => l.target_kind === kind).length
  const status = experimentStatusFor(e.status)
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        trail={[
          ...(e.project_id
            ? [
                {
                  label: project.data?.title ?? 'Project',
                  link: {
                    to: '/projects/$projectId' as const,
                    params: { projectId: e.project_id },
                  },
                },
              ]
            : []),
          { label: 'Experiments', link: { to: '/experiments' } },
          { label: e.identifier, mono: true },
        ]}
        title={
          e.locked_at || e.archived_at ? (
            e.title
          ) : (
            <RecordTitleInput
              recordId={e.id}
              title={e.title}
              tags={e.tags ?? []}
              className="h-auto w-full min-w-0 border-transparent bg-transparent px-0 text-title shadow-none max-md:text-[18px] max-md:leading-6"
            />
          )
        }
        meta={
          <>
            <span className="text-fg">
              <Status tone={status.tone}>{status.label}</Status>
            </span>
            <span>Owner {userLabel(e.created_by_user_id)}</span>
            <span className="max-lg:hidden">
              {e.status === 'draft' || e.status === 'planned'
                ? 'Not started'
                : `Started ${formatDate(e.created_at)}`}
            </span>
            {protocolLink ? (
              <span className="max-lg:hidden">
                Protocol{' '}
                <Link
                  to="/protocols/$protocolId"
                  params={{ protocolId: protocolLink.target_record_id ?? '' }}
                  className="mono text-link"
                >
                  {protocolLink.target_identifier}
                </Link>
              </span>
            ) : null}
          </>
        }
        actions={
          <>
            <CopyButton
              value={() => window.location.href}
              className="max-lg:hidden"
              copiedMessage="Link copied"
              failedMessage="Could not copy the link. Copy it from the address bar."
            >
              Share
            </CopyButton>
            {e.locked_at || e.archived_at ? null : (
              <BookInstrumentButton experimentId={e.id} />
            )}
            <ExperimentLifecycleActions experiment={e} />
            <AskAiButton />
          </>
        }
        tabs={
          <Tabs
            mode="url"
            label="Experiment sections"
            items={[
              {
                label: 'Overview',
                link: { to: '/experiments/$expId/overview', params },
              },
              {
                label: 'Notebook',
                link: { to: '/experiments/$expId/notebook', params },
              },
              {
                label: 'Samples',
                count: kindCount('sample'),
                link: { to: '/experiments/$expId/samples', params },
              },
              {
                label: 'Datasets',
                count: kindCount('dataset'),
                link: { to: '/experiments/$expId/datasets', params },
              },
              {
                label: 'Results',
                link: { to: '/experiments/$expId/results', params },
              },
              {
                label: 'Files',
                count: kindCount('file'),
                link: { to: '/experiments/$expId/files', params },
              },
              {
                label: 'Signatures',
                link: { to: '/experiments/$expId/signatures', params },
              },
              {
                label: 'History',
                link: { to: '/experiments/$expId/history', params },
              },
            ]}
          />
        }
      />
      <div className="flex min-h-0 flex-1">
        <Outlet />
      </div>
    </div>
  )
}
