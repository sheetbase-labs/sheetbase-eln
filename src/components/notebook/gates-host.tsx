import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { t } from '#/copy'
import {
  GateDialog,
  GoOnDialog,
  gateTargetsFrom,
  useRefreshGates,
} from '#/components/notebook/gates'
import type { GateDraft, GatesState } from '#/components/notebook/gates'
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
}: {
  recordId: string
  blocks: readonly NotebookBlock[]
  parts: readonly PartProgress[]
  canEdit: boolean
  enabled: boolean
}): { state: GatesState | null; dialogs: React.ReactNode } {
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
  const shape = [
    ...blocks
      .filter((b) => b.type === 'gate')
      .map((b) => `${b.id}:${b.version}`),
    ...parts.map(
      (p) =>
        `${p.id}:${JSON.stringify(p.opensWhen ?? null)}:${p.gateMode ?? ''}`,
    ),
  ].join('|')
  const seen = React.useRef(shape)
  React.useEffect(() => {
    if (seen.current === shape) return
    seen.current = shape
    void queryClient.invalidateQueries({
      queryKey: gateQueryKeys.forRecord(recordId),
    })
  }, [shape, queryClient, recordId])
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
    () => blocksBehindGates(context.blocks, gates),
    [context.blocks, gates],
  )
  const stepWaits = React.useMemo(
    () =>
      stepWaitsOnStep(
        context.blocks,
        new Set(parts.filter((p) => p.stepsInOrder).map((p) => p.id)),
      ),
    [context.blocks, parts],
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

  const editingBlock =
    editing?.kind === 'block'
      ? blocks.find((b) => b.id === editing.blockId)
      : undefined
  const editingPart =
    editing?.kind === 'part'
      ? parts.find((p) => p.id === editing.partId)
      : undefined

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
      {editing && (editingBlock || editingPart) ? (
        <GateDialog
          part={editingPart?.number}
          initial={
            editingBlock
              ? {
                  label:
                    typeof editingBlock.payload.label === 'string'
                      ? editingBlock.payload.label
                      : '',
                  mode: gateModeOf(editingBlock.payload),
                  conditions: gateConditionsOf(editingBlock.payload),
                }
              : {
                  mode: editingPart!.gateMode ?? 'warn',
                  conditions: editingPart!.opensWhen ?? [],
                  stepsInOrder: editingPart!.stepsInOrder ?? false,
                }
          }
          targets={
            editingBlock
              ? targetsFor(editingBlock.order)
              : gateTargetsFrom(context.blocks, context.parts, {
                  beforePart: editingPart!.number,
                })
          }
          named={Boolean(editingBlock)}
          canStepsInOrder={Boolean(editingPart)}
          removable={Boolean(editingPart) && !editingPart!.gateFromTemplate}
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
