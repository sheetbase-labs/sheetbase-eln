import { Link, Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { PageHeader } from '#/components/v3/ui/layout'
import { Tabs } from '#/components/v3/ui/tabs'
import { Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import { Button } from '#/components/v3/ui/button'
import { CopyButton } from '#/components/v3/ui/copy-button'
import { experimentStatus } from '#/components/v3/experiments/experiments-data'
import { notebookDataClient } from '#/lib/notebook-data'
import { useUserNames } from '#/lib/user-names'
import { resolveIdentifierParam } from '#/lib/identifier-resolution'
import { signInRedirect } from '#/lib/sign-in-redirect'

/** UI port (roadmap-4/ui-app3): the experiment detail frame. Overview, Samples,
 * Datasets, Results, Files and History are wired to real data; Notebook reuses
 * the record notebook. */
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
          identifier: string
          title: string
          status: string
          project_id: string | null
          created_by_user_id: string
          created_at: string
          updated_at: string
        }>(
          'records',
          `?id=eq.${recordId}&kind=eq.experiment&limit=1&select=id,identifier,title,status,project_id,created_by_user_id,created_at,updated_at`,
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
  const countKind = (kind: string) =>
    rows.filter((l) => l.target_kind === kind).length
  const params = { expId: e.id }
  const status = experimentStatusFor(e.status)
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        trail={[
          { label: 'Experiments', link: { to: '/experiments' } },
          { label: e.identifier, mono: true },
        ]}
        title={e.title}
        meta={
          <>
            <span className="text-fg">
              <Status tone={status.tone}>{status.label}</Status>
            </span>
            <span>Owner {userLabel(e.created_by_user_id)}</span>
            <span className="max-lg:hidden">
              Started {e.created_at.slice(0, 10)}
            </span>
          </>
        }
        actions={
          <>
            <CopyButton
              value={window.location.href}
              className="max-lg:hidden"
              copiedMessage="Link copied"
              failedMessage="Could not copy the link. Copy it from the address bar."
            >
              Share
            </CopyButton>
            <Button
              variant="primary"
              nativeButton={false}
              render={
                <Link
                  to="/records/$recordId/notebook"
                  params={{ recordId: e.id }}
                />
              }
            >
              Open notebook
            </Button>
          </>
        }
        tabs={
          <Tabs
            mode="url"
            label="Experiment sections"
            items={[
              {
                label: 'Overview',
                link: {
                  to: '/experiments/$expId',
                  params,
                  activeOptions: { exact: true },
                },
              },
              {
                label: 'Notebook',
                link: { to: '/experiments/$expId/notebook', params },
              },
              {
                label: 'Samples',
                count: countKind('sample'),
                link: { to: '/experiments/$expId/samples', params },
              },
              {
                label: 'Datasets',
                count: countKind('dataset'),
                link: { to: '/experiments/$expId/datasets', params },
              },
              {
                label: 'Results',
                link: { to: '/experiments/$expId/results', params },
              },
              {
                label: 'Files',
                count: countKind('file'),
                link: { to: '/experiments/$expId/files', params },
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
