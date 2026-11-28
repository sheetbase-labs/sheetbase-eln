/**
 * A record of a lab's own model (a registry entry, an incident, a request) on
 * the shared record page. It opens on Details, the fields its model defines;
 * the notebook, links, revisions and signatures sit beside it, History at the
 * far end. The notebook stays mounted on every tab so its Submit, Sign and ⋯
 * actions stay in the header wherever the reader is.
 */
import {
  getRouteApi,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { FavouriteToggle } from '#/components/favourites/favourite-toggle'
import {
  RecordModelDetails,
  useRecordHeaderFacts,
} from '#/components/models/record-model-record'
import { useWorkspaceRecordModel } from '#/components/models/models-data'
import {
  RecordActionItems,
  RecordActionsProvider,
  RecordMainActionsSlot,
  useOfferedRecordActions,
} from '#/components/notebook/record-actions'
import { RecordLockedLine } from '#/components/record-page/record-locked-line'
import { RecordPage } from '#/components/record-page/record-page'
import {
  RecordActivity,
  RecordHistoryTab,
  RecordLinks,
  RecordProperties,
} from '#/components/record-page/record-side-panel'
import { hasCapability } from '#/lib/capability'
import { formatDate } from '#/lib/format-date'
import { statusTone, statusWord } from '#/lib/status-words'
import {
  fetchProject,
  fetchRecord,
  notebookDataClient,
  notebookQueryKeys,
} from '#/lib/notebook-data'
import type { NotebookRecord } from '#/lib/notebook-data'
import { useUserNames } from '#/lib/user-names'
import { cn } from '#/lib/utils'
import { t } from '#/copy'

import {
  NotebookSkeleton,
  RecordNotebookPage,
  RecordNotebookPanel,
  useRecordPanelData,
} from './-notebook-page'
import { recordShellFacts, recordShellTabs } from './-record-shell-data'
import type { RecordShellTab } from './-record-shell-data'

const Route = getRouteApi('/records/$recordId/notebook')

type RecordRouteContext = ReturnType<typeof Route.useRouteContext>['context']

/**
 * Experiments have one page: `/experiments/$expId` (its Notebook tab is this
 * same surface). A link to the record notebook of an experiment, old or new,
 * lands there, with the revision search and block anchor kept. Every other
 * record kind opens on the shared record page.
 */
export function RecordNotebookRoute() {
  const { context } = Route.useRouteContext()
  const { recordId } = Route.useParams()
  const navigate = useNavigate()

  const record = useQuery({
    queryKey: notebookQueryKeys.record(recordId),
    queryFn: () => fetchRecord(notebookDataClient, recordId),
  })

  const search = useRouterState({ select: (state) => state.location.search })
  const hash = useRouterState({ select: (state) => state.location.hash })
  const isExperiment = record.data?.kind === 'experiment'
  useEffect(() => {
    if (!isExperiment) return
    void navigate({
      to: '/experiments/$expId/notebook',
      params: { expId: recordId },
      search: true,
      hash: hash || undefined,
      replace: true,
    })
  }, [isExperiment, navigate, recordId, search, hash])

  if (isExperiment) return <NotebookSkeleton />

  // Loading, refused and missing records keep the notebook's own states.
  if (!record.data)
    return <RecordNotebookPage context={context} recordId={recordId} />

  return (
    <RecordActionsProvider>
      <RecordShell context={context} record={record.data} />
    </RecordActionsProvider>
  )
}

/** A revision or block in the address means the notebook is what was asked for. */
function useOpeningTab(): RecordShellTab {
  const search = useRouterState({ select: (state) => state.location.search })
  const hash = useRouterState({ select: (state) => state.location.hash })

  const revision = 'revision' in search

  return revision || hash ? 'notebook' : 'details'
}

function RecordShell({
  context,
  record,
}: {
  context: RecordRouteContext
  record: NotebookRecord
}) {
  const opening = useOpeningTab()
  const [tab, setTab] = useState<RecordShellTab>(opening)
  const model = useWorkspaceRecordModel(record.kind)
  const panels = useRecordPanelData(record.id)
  const offered = useOfferedRecordActions()
  const canWrite = hasCapability(context.workspace?.role, 'record.create')
  const { userLabel } = useUserNames([record.createdByUserId])
  const modelFacts = useRecordHeaderFacts(record.kind, record.id)

  const project = useQuery({
    queryKey: notebookQueryKeys.project(record.projectId ?? 'none'),
    queryFn: () => fetchProject(notebookDataClient, record.projectId!),
    enabled: Boolean(record.projectId),
  })

  const modelName = model.data?.name ?? record.kind
  const onNotebook = tab === 'notebook'

  return (
    <RecordPage
      recordId={record.id}
      trail={[
        {
          label: modelName,
          link: {
            to: '/models/$modelId/records',
            params: { modelId: record.kind },
          },
        },
        { label: record.identifier, mono: true },
      ]}
      title={record.title}
      identifier={record.identifier}
      status={recordShellStatus(record)}
      facts={recordShellFacts({
        record,
        modelName,
        projectTitle: project.data?.title ?? null,
        ownerName: userLabel(record.createdByUserId),
        modelFacts,
      })}
      actions={
        <>
          <FavouriteToggle kind="record" objectId={record.id} />
          <RecordMainActionsSlot />
        </>
      }
      moreLabel={t('notebook.recordPage.moreRecordActions')}
      more={offered.length ? <RecordActionItems actions={offered} /> : null}
      stateLine={
        record.lockedAt ? (
          <RecordLockedLine
            recordId={record.id}
            lockedAt={record.lockedAt}
            canAmend={canWrite && !record.archivedAt}
          />
        ) : null
      }
      tabs={recordShellTabs({
        tab,
        onTab: setTab,
        links: panels.links.data?.length ?? 0,
        sequences: panels.sequences.data?.length ?? 0,
        revisions: panels.revisions.data?.length ?? 0,
        signatures: panels.signatures.data?.length ?? 0,
      })}
      side={
        onNotebook ? null : (
          <>
            <RecordProperties
              items={[
                {
                  label: t('notebook.recordPage.createdField'),
                  value: formatDate(record.createdAt, { time: true }),
                },
              ]}
            />
            <RecordLinks id={record.id} />
            <RecordActivity
              recordId={record.id}
              onShowHistory={() => setTab('history')}
            />
          </>
        )
      }
      flush={!onNotebook}
      fill={onNotebook}
    >
      {/* The notebook is kept, hidden, on the other tabs: it owns the
          header's Submit, Sign and ⋯ actions and the dialogs they open. */}
      <div
        className={cn('flex min-h-0 min-w-0 flex-1', !onNotebook && 'hidden')}
      >
        <RecordNotebookPage context={context} recordId={record.id} embedded />
      </div>
      {onNotebook ? null : (
        <div className="flex min-w-0 flex-1 flex-col">
          <RecordShellBody
            tab={tab}
            record={record}
            role={context.workspace?.role ?? null}
            canWrite={canWrite}
            panels={panels}
          />
        </div>
      )}
    </RecordPage>
  )
}

/** The record's status, in the shared words and ring. */
function recordShellStatus(
  record: NotebookRecord,
): NonNullable<Parameters<typeof RecordPage>[0]['status']> {
  return {
    tone: statusTone(record.status),
    label: statusWord(record.status),
  }
}

function RecordShellBody({
  tab,
  record,
  role,
  canWrite,
  panels,
}: {
  tab: Exclude<RecordShellTab, 'notebook'>
  record: NotebookRecord
  role: string | null
  canWrite: boolean
  panels: ReturnType<typeof useRecordPanelData>
}) {
  if (tab === 'details')
    return (
      <RecordModelDetails
        modelKey={record.kind}
        recordId={record.id}
        role={role}
      />
    )

  if (tab === 'history')
    return (
      <div className="px-4 py-5 md:px-6">
        <RecordHistoryTab recordId={record.id} />
      </div>
    )

  return (
    <div className="px-4 md:px-6">
      <RecordNotebookPanel
        tab={tab}
        links={panels.links.data ?? []}
        revisions={panels.revisions.data ?? []}
        signatures={panels.signatures.data ?? []}
        signatureError={panels.signatures.isError}
        signaturesLoading={panels.signatures.isPending}
        recordId={record.id}
        projectId={record.projectId}
        canWrite={canWrite && !record.lockedAt && record.status !== 'approved'}
      />
    </div>
  )
}
