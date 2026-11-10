import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import { t } from '#/copy'
import {
  GateDialog,
  GoOnDialog,
  useRefreshGates,
} from '#/components/notebook/gates'
import type { GateDraft, GatesState } from '#/components/notebook/gates'
import { gateTargetsFrom } from './gate-description'
import { toast } from '#/components/ui/sonner'
import {
  blocksBehindGates,
  fetchRecordGates,
  gateConditionsOf,
  gateModeOf,
  gateQueryKeys,
  gateRefusal,
  liveGate,
  setPartGate,
  stepWaitsOnStep,
} from '#/lib/experiment-gates'
import type { GateContext, RecordGate } from '#/lib/experiment-gates'
import type { PartProgress } from '#/lib/experiment-parts'
import { notebookDataClient, notebookQueryKeys } from '#/lib/notebook-data'
import { useUserNames } from '#/lib/user-names'
import type { NotebookBlock } from '#/lib/notebook-data'
import { updateBlockPayload } from '#/lib/notebook-mutations'

/** Both configured gates and their checked table versions can change the persisted result. */
function gateInputsVersion(
  blocks: readonly NotebookBlock[],
  parts: readonly PartProgress[],
) {
  const checkedTables = new Set(
    blocks
      .filter((block) => block.type === 'gate')
      .flatMap((block) => gateConditionsOf(block.payload))
      .flatMap((condition) =>
        condition.kind === 'plugin_check' ? [condition.blockId] : [],
      ),
  )

  return [
    ...blocks.flatMap((block) =>
      block.type === 'gate' || checkedTables.has(block.id)
        ? [`${block.id}:${block.version}`]
        : [],
    ),
    ...parts.map(
      (part) =>
        `${part.id}:${JSON.stringify(part.opensWhen ?? null)}:${part.gateMode ?? ''}`,
    ),
  ].join('|')
}

/**
 * The gates of an experiment as the page shows them: the database's answer,
 * checked again against what the page holds, plus the dialogs to go on past a
 * gate and to change one.
 */
export function useNotebookGates({
  recordId,
  blocks,
  parts,
  canEdit,
  enabled,
  describeOnly = false,
}: {
  recordId: string
  blocks: readonly NotebookBlock[]
  parts: readonly PartProgress[]
  canEdit: boolean
  enabled: boolean
  /** A protocol: gates are shown as written, and hold nothing back. */
  describeOnly?: boolean
}) {
  const queryClient = useQueryClient()
  const refresh = useRefreshGates(recordId)

  const query = useQuery({
    queryKey: gateQueryKeys.forRecord(recordId),
    queryFn: () => fetchRecordGates(notebookDataClient, recordId),
    enabled,
  })

  const names = useUserNames(
    (query.data ?? [])
      .map((gate) => gate.overriddenByUserId)
      .filter((id): id is string => Boolean(id)),
  )

  const nameOf = React.useCallback(
    (userId: string | null) => (userId ? names.userLabel(userId) : ''),
    [names],
  )

  // A gate added, changed or removed on the page: ask the database again.
  // A table a plugin check reads: when it changes, the stored answer is stale.
  const gateVersionKey = gateInputsVersion(blocks, parts)

  const seen = React.useRef(gateVersionKey)
  React.useEffect(() => {
    if (seen.current === gateVersionKey) return
    seen.current = gateVersionKey
    void queryClient.invalidateQueries({
      queryKey: gateQueryKeys.forRecord(recordId),
    })
  }, [gateVersionKey, queryClient, recordId])
  const [goingOn, setGoingOn] = React.useState<RecordGate | null>(null)
  const [editing, setEditing] = React.useState<RecordGate | null>(null)

  const context = React.useMemo<GateContext>(
    () => ({
      blocks: blocks.map((b) => ({
        id: b.id,
        type: b.type,
        partId: b.partId ?? null,
        order: b.order,
        payload: b.payload,
      })),
      parts: parts.map((p) => ({
        id: p.id,
        number: p.number,
        title: p.title,
        state: p.state,
        sourcePartId: p.sourcePartId ?? null,
      })),
    }),
    [blocks, parts],
  )

  const gates = React.useMemo(() => {
    const today = new Date()

    return (query.data ?? []).map((gate) => {
      if (gate.kind === 'block') {
        const block = blocks.find((b) => b.id === gate.blockId)

        return liveGate(
          gate,
          block ? gateConditionsOf(block.payload) : null,
          context,
          today,
        )
      }

      const part = parts.find((p) => p.id === gate.partId)

      return liveGate(gate, part?.opensWhen ?? null, context, today)
    })
  }, [query.data, blocks, parts, context])

  const held = React.useMemo(
    () =>
      describeOnly
        ? new Map<string, RecordGate>()
        : blocksBehindGates(context.blocks, gates),
    [context.blocks, gates, describeOnly],
  )

  const stepWaits = React.useMemo(
    () =>
      describeOnly
        ? new Map<string, number>()
        : stepWaitsOnStep(
            context.blocks,
            new Set(parts.filter((p) => p.stepsInOrder).map((p) => p.id)),
          ),
    [context.blocks, parts, describeOnly],
  )

  const targetsFor = React.useCallback(
    (beforeOrder?: number) =>
      gateTargetsFrom(context.blocks, context.parts, { beforeOrder }),
    [context],
  )

  const show = React.useCallback((blockId: string) => {
    window.location.hash = `block-${blockId}`
    window.setTimeout(() => {
      document
        .querySelector(`[id="block-${blockId}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 50)
  }, [])

  const state = React.useMemo<GatesState | null>(
    () =>
      gates.length === 0 && stepWaits.size === 0 && !canEdit
        ? null
        : {
            recordId,
            gates,
            held,
            stepWaits,
            canEdit,
            describeOnly,
            context,
            nameOf,
            goOn: setGoingOn,
            edit: setEditing,
            show,
            targetsFor,
          },
    [
      gates,
      held,
      stepWaits,
      canEdit,
      describeOnly,
      context,
      nameOf,
      show,
      targetsFor,
      recordId,
    ],
  )

  const save = useMutation({
    mutationFn: async (draft: GateDraft) => {
      if (!editing) return

      if (editing.kind === 'block') {
        const block = blocks.find((b) => b.id === editing.blockId)

        if (!block) return
        await updateBlockPayload(notebookDataClient, {
          blockId: block.id,
          expectedVersion: block.version,
          payload: {
            ...block.payload,
            label: draft.label.trim() || undefined,
            mode: draft.mode,
            conditions: draft.conditions,
          },
        })

        return
      }

      await setPartGate(notebookDataClient, editing.partId!, {
        conditions: draft.conditions,
        mode: draft.mode,
        stepsInOrder: draft.stepsInOrder,
      })
    },
    onSuccess: async () => {
      await Promise.all([
        refresh(),
        queryClient.invalidateQueries({
          queryKey: notebookQueryKeys.blocks(recordId),
        }),
      ])
      toast.success(t('notebook.gates.saved'))
      setEditing(null)
    },
    onError: (error) => {
      const refusal = gateRefusal(error)
      toast.error(refusal?.message || t('notebook.gates.couldNotSave'))
    },
  })

  // useRefreshGates refreshes gate and part queries after this mutation.
  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation
  const clearPart = useMutation({
    mutationFn: async () => {
      if (editing?.kind !== 'part') return
      await setPartGate(notebookDataClient, editing.partId!, {
        conditions: null,
        stepsInOrder: false,
      })
    },
    onSuccess: async () => {
      await refresh()
      toast.success(t('notebook.gates.removed'))
      setEditing(null)
    },
    onError: () => toast.error(t('notebook.gates.couldNotSave')),
  })

  const dialogs = (
    <>
      {goingOn ? (
        <GoOnDialog
          gate={goingOn}
          recordId={recordId}
          onClose={() => setGoingOn(null)}
          onDone={async () => {
            await Promise.all([
              refresh(),
              queryClient.invalidateQueries({
                queryKey: notebookQueryKeys.blocks(recordId),
              }),
            ])
          }}
        />
      ) : null}
      {editing ? (
        <EditingGateDialog
          gate={editing}
          blocks={blocks}
          parts={parts}
          context={context}
          saving={save.isPending || clearPart.isPending}
          onSave={(draft) => save.mutateAsync(draft).then(() => undefined)}
          onRemove={() => clearPart.mutateAsync().then(() => undefined)}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  )

  return { state, dialogs }
}

/** Resolve the editable source separately from the live gate evaluation. */
function EditingGateDialog({
  gate,
  blocks,
  parts,
  context,
  ...actions
}: {
  gate: RecordGate
  blocks: readonly NotebookBlock[]
  parts: readonly PartProgress[]
  context: GateContext
  saving: boolean
  onSave: (draft: GateDraft) => Promise<void>
  onRemove: () => Promise<void>
  onClose: () => void
}) {
  if (gate.kind === 'block') {
    const block = blocks.find((candidate) => candidate.id === gate.blockId)

    if (!block) return null

    return (
      <GateDialog
        {...actions}
        initial={{
          label: z.string().catch('').parse(block.payload.label),
          mode: gateModeOf(block.payload),
          conditions: gateConditionsOf(block.payload),
        }}
        targets={gateTargetsFrom(context.blocks, context.parts, {
          beforeOrder: block.order,
        })}
        named
        canStepsInOrder={false}
        removable={false}
      />
    )
  }

  const part = parts.find((candidate) => candidate.id === gate.partId)

  if (!part) return null

  return (
    <GateDialog
      {...actions}
      part={part.number}
      initial={{
        mode: part.gateMode ?? 'warn',
        conditions: part.opensWhen ?? [],
        stepsInOrder: part.stepsInOrder ?? false,
      }}
      targets={gateTargetsFrom(context.blocks, context.parts, {
        beforePart: part.number,
      })}
      named={false}
      canStepsInOrder
      removable={!part.gateFromTemplate}
    />
  )
}
