/**
 * AUTO-03 — pipeline_output notebook block editor: pick a Pipeline run and
 * pin its produced Dataset Version into the notebook. Empty drafts are
 * valid; choosing a run writes the run id plus the first output's Dataset
 * Version identity.
 */
import { t } from '#/copy'
import { PickerSelect } from '#/components/record-picker/entity-picker'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import { Field, Input } from '#/components/ui/input'
import { Icon } from '#/components/icons'
import { createDataClient } from '#/lib/data-client'
import { formatRelativeTime } from '#/lib/notebook-data'
import {
  agentOperationQueryKeys,
  decideAgentOperation,
  executeAgentOperation,
  proposalRevision,
} from '#/lib/agent-operations'
import {
  listPipelineRunOutputs,
  listRecentPipelineRuns,
  pipelineQueryKeys,
} from '#/lib/pipelines/data'
import type { PipelineRunWire } from '#/lib/pipelines/types'
import type { AutosaveStatus } from './use-autosave'
import type { BlockEditorProps } from './block-editor'
import { pipelineOutputPayload } from './pipeline-output-payload'
import {
  PipelineProposalAbsent,
  PipelineProposalBlock,
  PipelineProposalUnreadable,
  usePipelineProposalQuery,
} from './pipeline-output-block-proposal'

const dataClient = createDataClient()

export function PipelineOutputBlockEditor({
  block,
  save,
  offline,
  onStatusChange,
  readOnly,
}: {
  block: { payload: unknown; payloadSchemaVersion: number }
  save: BlockEditorProps['save']
  offline?: boolean
  onStatusChange?: (status: AutosaveStatus) => void
  readOnly?: boolean
}) {
  const initial = useMemo(
    () => pipelineOutputPayload.parse(block.payload ?? {}),
    [block.payload],
  )

  const { runId, touched, saving, chooseRun, editRun } = useRunReference({
    initial,
    save,
    onStatusChange,
  })

  const runsQuery = useQuery({
    queryKey: ['pipelines', 'recent-runs'],
    queryFn: () => listRecentPipelineRuns(dataClient, 20),
  })

  const runs = runsQuery.data ?? []

  const outputsQuery = useQuery({
    queryKey: pipelineQueryKeys.runOutputs(runId),
    queryFn: () => listPipelineRunOutputs(dataClient, runId),
    enabled: Boolean(runId),
  })

  const selected = runs.find((r) => r.id === runId) ?? null

  const status = (run: PipelineRunWire) => {
    if (run.status === 'succeeded')
      return t('notebook.pipelineOutputBlockEditor.succeededRelativetime', {
        relativeTime: formatRelativeTime(run.finished_at ?? run.started_at),
      })

    if (run.status === 'failed')
      return t('notebook.pipelineOutputBlockEditor.failedWithCode', {
        code: run.error_code ?? '',
      })

    return run.status
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-center gap-2">
        <Icon
          name="pipeline"
          size={16}
          className="text-link"
          aria-hidden="true"
        />
        <span className="text-sm font-medium">
          {t('notebook.pipelineOutputBlockEditor.pipelineOutputReference')}
        </span>
      </div>

      <EditableProposalReference
        proposalId={initial.proposalId ?? null}
        runId={runId}
        label={initial.label}
        readOnly={Boolean(readOnly)}
      />

      <Field label={t('notebook.pipelineOutputBlockEditor.label')}>
        <PickerSelect
          noun="pipeline run"
          value={runId}
          onChange={(id) => void chooseRun(id)}
          aria-label={t('notebook.pipelineOutputBlockEditor.label')}
          disabled={readOnly}
          placeholder={t('notebook.pipelineOutputBlockEditor.selectARun')}
          options={runs.map((run) => ({
            id: run.id,
            identifier: run.id.slice(0, 8),
            label: status(run),
          }))}
        />
      </Field>

      {selected ? (
        <div className="text-fg-muted space-y-1 text-xs">
          <p>
            {outputsQuery.data?.length
              ? t(
                  'notebook.pipelineOutputBlockEditor.pinsDatasetVersionDataset',
                  {
                    dataset_version_id:
                      outputsQuery.data[0].dataset_version_id.slice(0, 8),
                    label: outputsQuery.data[0].label,
                  },
                )
              : t('notebook.pipelineOutputBlockEditor.thisRunProducedNo')}
          </p>
          <Link
            to="/pipelines/runs/$runId"
            params={{ runId: selected.id }}
            className="text-link underline-offset-2 hover:underline"
          >
            {t('notebook.pipelineOutputBlockEditor.inspectRun')}
          </Link>
        </div>
      ) : null}

      {runId || touched ? (
        <Field label={t('notebook.pipelineOutputBlockEditor.orPasteARunLabel')}>
          <Input
            className="mono"
            value={runId}
            onChange={(event) => editRun(event.target.value)}
            onBlur={() => {
              if (touched) void chooseRun(runId)
            }}
            aria-label={t('notebook.pipelineOutputBlockEditor.ariaLabel')}
            disabled={readOnly}
          />
        </Field>
      ) : null}

      {!readOnly && (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={saving || !touched}
            onClick={() => void chooseRun('')}
          >
            {t('notebook.pipelineOutputBlockEditor.clearReference')}
          </Button>
          {offline ? (
            <span className="text-fg-muted text-xs">
              {t('notebook.pipelineOutputBlockEditor.offlineChangesWillSync')}
            </span>
          ) : null}
        </div>
      )}
    </div>
  )
}

/** Proposal decisions have their own server-owned lifecycle, not the run draft's. */
function EditableProposalReference({
  proposalId,
  runId,
  label,
  readOnly,
}: {
  proposalId: string | null
  runId: string
  label: string | undefined
  readOnly: boolean
}) {
  const proposalQuery = usePipelineProposalQuery(proposalId)
  const queryClient = useQueryClient()
  const [actionError, setActionError] = useState<string | null>(null)
  const proposal = proposalQuery.data ?? null

  // The decision RPCs are the authority; re-read instead of merging locally.
  const settleProposal = () => {
    setActionError(null)
    void queryClient.invalidateQueries({
      queryKey: agentOperationQueryKeys.proposals,
    })
  }

  const decide = useMutation({
    mutationFn: ({
      target,
      revision,
      decision,
      reason,
    }: {
      target: string
      revision: number
      decision: 'approve' | 'reject'
      reason?: string | null
    }) =>
      decideAgentOperation(dataClient, {
        proposalId: target,
        expectedRevision: revision,
        decision,
        reason: reason ?? null,
      }),
    onSuccess: settleProposal,
    onError: (error) =>
      setActionError(
        error instanceof Error
          ? error.message
          : t('notebook.pipelineOutputBlockEditor.theDecisionCouldNot'),
      ),
  })

  const execute = useMutation({
    mutationFn: (target: { id: string; revision: number }) =>
      executeAgentOperation(dataClient, {
        proposalId: target.id,
        expectedRevision: target.revision,
      }),
    onSuccess: settleProposal,
    onError: (error) =>
      setActionError(
        error instanceof Error
          ? error.message
          : t('notebook.pipelineOutputBlockEditor.theChangeCouldNot'),
      ),
  })

  if (!proposalId) return <PipelineProposalAbsent />

  if (!proposal)
    return proposalQuery.isPending ? (
      <p className="text-fg-muted text-xs" role="status">
        {t('notebook.pipelineOutputBlockEditor.loadingTheLinkedProposal')}
      </p>
    ) : (
      <PipelineProposalUnreadable />
    )

  const pending = decide.isPending
    ? decide.variables.decision
    : execute.isPending
      ? 'execute'
      : null

  const currentOutput = runId
    ? label
      ? t('notebook.pipelineOutputBlockEditor.runWithLabel', {
          id: runId.slice(0, 8),
          label,
        })
      : t('notebook.pipelineOutputBlockEditor.run', {
          id: runId.slice(0, 8),
        })
    : null

  return (
    <PipelineProposalBlock
      proposal={proposal}
      runId={runId || proposal.preview.target.id || null}
      currentOutput={currentOutput}
      readOnly={readOnly}
      pending={pending}
      error={actionError}
      onDecide={(decision, reason) =>
        decide.mutate({
          target: proposal.id,
          revision: proposalRevision(proposal),
          decision,
          reason,
        })
      }
      onExecute={() =>
        execute.mutate({
          id: proposal.id,
          revision: proposalRevision(proposal),
        })
      }
    />
  )
}

/** A run lookup may only persist while it is still the scientist's selection. */
function useRunReference({
  initial,
  save,
  onStatusChange,
}: {
  initial: ReturnType<typeof pipelineOutputPayload.parse>
  save: BlockEditorProps['save']
  onStatusChange: BlockEditorProps['onStatusChange']
}) {
  const [runId, setRunId] = useState(initial.runId ?? '')
  const [touched, setTouched] = useState(false)
  const [pendingSaves, setPendingSaves] = useState(0)
  const selection = useRef(0)

  useEffect(
    () => () => {
      selection.current += 1
    },
    [],
  )

  function editRun(value: string) {
    selection.current += 1
    setRunId(value)
    setTouched(true)
    onStatusChange?.('dirty')
  }

  async function persist(
    payload: BlockEditorProps['block']['payload'],
    request: number,
  ) {
    setPendingSaves((count) => count + 1)
    onStatusChange?.('saving')

    try {
      const result = await save(payload)

      if (request === selection.current)
        onStatusChange?.(result.ok ? 'clean' : 'failed')
    } catch {
      if (request === selection.current) onStatusChange?.('failed')
    } finally {
      setPendingSaves((count) => count - 1)
    }
  }

  async function chooseRun(nextRunId: string) {
    const request = ++selection.current
    setRunId(nextRunId)
    setTouched(Boolean(nextRunId))
    onStatusChange?.('dirty')

    const proposalLink = initial.proposalId
      ? { proposalId: initial.proposalId }
      : {}

    if (!nextRunId) {
      await persist(proposalLink, request)

      return
    }

    try {
      const outputs = await listPipelineRunOutputs(dataClient, nextRunId)

      // A lookup cannot overwrite a later choice, a cleared link or an unmount.
      if (request !== selection.current) return
      const first = outputs.at(0)
      await persist(
        {
          ...proposalLink,
          runId: nextRunId,
          datasetId: first?.dataset_id ?? null,
          datasetVersionId: first?.dataset_version_id ?? null,
          label: first?.label ?? null,
        },
        request,
      )
    } catch {
      if (request === selection.current) onStatusChange?.('failed')
    }
  }

  return { runId, touched, saving: pendingSaves > 0, chooseRun, editRun }
}
