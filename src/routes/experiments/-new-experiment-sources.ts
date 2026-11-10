/**
 * The reads behind the new-experiment form: the projects the account can see
 * and write to, the workspace's people, the protocols and published templates
 * it can start from, and whatever page handed the form a sample or a series.
 */
import { useQuery } from '@tanstack/react-query'

import { buildTemplateRows } from '#/components/templates/templates-data'
import { t } from '#/copy'
import {
  fetchAllNotebookTemplateVersions,
  fetchNotebookTemplates,
} from '#/lib/notebook-template-data'
import { notebookDataClient } from '#/lib/notebook-data'
import { fetchMyProjectAssignments } from '#/lib/workspace-access'

/** One project as the picker needs it: its access is resolved separately. */
export interface ProjectOption {
  id: string
  title: string
  archived_at: string | null
  status: string
  default_reviewer_user_id?: string | null
}

/**
 * How long the form waits for the reads that gate the picker. The form cannot
 * stay inert on a read that never settles — a stalled request, a hydration
 * mismatch or a dead proxy all look identical to the author — so past the
 * deadline the form states the failure and offers a retry.
 */
export const FORM_READ_TIMEOUT_MS = 10_000

/** Reject when `read` has not answered within the form's budget. */
export function withDeadline<T>(read: Promise<T>, label: string): Promise<T> {
  // Executor form: tsconfig lib predates Promise.withResolvers (ES2024).
  const deadline = new Promise<never>((_resolve, reject) => {
    setTimeout(
      () =>
        reject(
          new Error(
            t('projects.newExperiment.timeout', {
              label,
              seconds: FORM_READ_TIMEOUT_MS / 1000,
            }),
          ),
        ),
      FORM_READ_TIMEOUT_MS,
    )
  })

  // The losing side is handled by `race`, so a late rejection is never
  // unhandled — and a settled read leaves only one idle timer behind.
  return Promise.race([read, deadline])
}

/** What a page that linked here handed over, and whether a template is wanted. */
interface NewExperimentSources {
  sampleId?: string
  seriesId?: string
  templateWanted: boolean
}

export function useNewExperimentSources({
  sampleId,
  seriesId,
  templateWanted,
}: NewExperimentSources) {
  const projects = useQuery({
    queryKey: ['ui-port', 'experiments', 'new', 'projects'],
    queryFn: () =>
      withDeadline(
        notebookDataClient.list<ProjectOption>(
          'projects',
          '?select=id,title,archived_at,status,default_reviewer_user_id&order=title.asc',
        ),
        t('projects.newExperiment.projectList'),
      ),
    staleTime: 60_000,
    retry: false,
  })

  // Which of those projects the caller may write to. `api.projects` returns
  // every project the account can *view*; the create RPC inserts under
  // `records_live_insert`, so a view-only default fails with a raw RLS error.
  const assignments = useQuery({
    queryKey: ['ui-port', 'experiments', 'new', 'project-access'],
    queryFn: () =>
      withDeadline(
        fetchMyProjectAssignments(notebookDataClient),
        t('projects.newExperiment.permissionCheck'),
      ),
    staleTime: 60_000,
    retry: false,
  })

  const members = useQuery({
    queryKey: ['ui-port', 'experiments', 'new', 'members'],
    queryFn: () =>
      notebookDataClient.rpc<{ user_id: string; name: string; role: string }[]>(
        'workspace_members_list',
        {},
      ),
    staleTime: 60_000,
  })

  const protocols = useQuery({
    queryKey: ['ui-port', 'experiments', 'new', 'protocols'],
    queryFn: () =>
      notebookDataClient.list<{
        id: string
        identifier: string
        title: string
      }>(
        'records',
        '?kind=eq.protocol_template&deleted_at=is.null&order=identifier.asc&select=id,identifier,title&limit=100',
      ),
    staleTime: 60_000,
  })

  const protocolVersions = useQuery({
    queryKey: ['ui-port', 'experiments', 'new', 'protocol-versions'],
    queryFn: () =>
      notebookDataClient.list<{
        id: string
        protocol_record_id: string
        version: number
      }>(
        'protocol_versions',
        '?status=eq.effective&order=version.desc&select=id,protocol_record_id,version&limit=100',
      ),
    staleTime: 60_000,
  })

  // Published notebook templates, only once the author asks to start from one.
  const templates = useQuery({
    queryKey: ['ui-port', 'experiments', 'new', 'templates'],
    enabled: templateWanted,
    queryFn: async () => {
      const [list, versions] = await Promise.all([
        fetchNotebookTemplates(notebookDataClient, { limit: 200 }),
        fetchAllNotebookTemplateVersions(notebookDataClient),
      ])

      return buildTemplateRows(list, versions, []).filter(
        (row) => row.published && row.lifecycle !== 'retired',
      )
    },
    staleTime: 60_000,
  })

  // A sample handed over by the page that linked here: it is linked to the new
  // experiment, and named in the form so the author sees what will be linked.
  const sample = useQuery({
    queryKey: ['ui-port', 'experiments', 'new', 'sample', sampleId],
    queryFn: async () =>
      (
        await notebookDataClient.list<{
          id: string
          identifier: string
          title: string
        }>(
          'records',
          `?id=eq.${encodeURIComponent(sampleId ?? '')}&select=id,identifier,title&limit=1`,
        )
      ).at(0) ?? null,
    enabled: Boolean(sampleId),
    staleTime: 60_000,
  })

  // A series handed over by its page: the new experiment joins it once made.
  const series = useQuery({
    queryKey: ['ui-port', 'experiments', 'new', 'series', seriesId],
    queryFn: async () =>
      (
        await notebookDataClient.list<{
          id: string
          identifier: string
          title: string
        }>(
          'records',
          `?id=eq.${encodeURIComponent(seriesId ?? '')}&select=id,identifier,title&limit=1`,
        )
      ).at(0) ?? null,
    enabled: Boolean(seriesId),
    staleTime: 60_000,
  })

  return {
    projects,
    assignments,
    members,
    protocols,
    protocolVersions,
    templates,
    sample,
    series,
  }
}
