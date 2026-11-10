/**
 * The notebook page's parts: which part is shown, the gate that part carries,
 * its sign-off, and the blocks the canvas renders.
 *
 * With no parts the notebook is one page; split into parts, it shows one at a
 * time and the rest stay a click away.
 */
import { useMemo } from 'react'
import { useRouterState } from '@tanstack/react-router'

import {
  blocksOfPart,
  currentPart,
  partNumberFromParam,
  shownPart,
} from '#/lib/experiment-parts'
import { useRecordPartsProgress } from '#/components/notebook/use-record-parts'
import { useNotebookGates } from '#/components/notebook/gates-host'
import {
  usePartRequests,
  usePartSignoffs,
} from '#/components/notebook/part-signoff'
import { hasCapability } from '#/lib/capability'
import { stepProgress } from '#/lib/step-status'
import { useUserNames } from '#/lib/user-names'
import type {
  NotebookBlock as NotebookBlockDomain,
  NotebookRecord,
} from '#/lib/notebook-data'

export function useNotebookParts({
  recordId,
  record,
  blocks,
  partParam,
  historicalRevisionId,
  workspaceRole,
  currentUserId,
}: {
  recordId: string
  record: NotebookRecord | null
  blocks: NotebookBlockDomain[]
  partParam: string | undefined
  historicalRevisionId: string | undefined
  workspaceRole: string | null
  currentUserId: string
}) {
  const partsView = useRecordPartsProgress(
    recordId,
    blocks,
    !historicalRevisionId,
  )

  const partsList = partsView.parts

  const hashedBlockId = useRouterState({
    select: (state) =>
      /block-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(
        state.location.hash,
      )?.[1] ?? null,
  })

  const partOfHashedBlock = hashedBlockId
    ? (blocks.find((block) => block.id === hashedBlockId)?.partId ?? null)
    : null

  const requestedPart =
    partNumberFromParam(partParam) ??
    (partOfHashedBlock
      ? (partsList.find((part) => part.id === partOfHashedBlock)?.number ??
        null)
      : null)

  const partNames = useUserNames(
    partsList
      .map((part) => part.completedByUserId)
      .filter((id): id is string => Boolean(id)),
  )

  const gatesHost = useNotebookGates({
    recordId,
    blocks,
    parts: partsList,
    canEdit: Boolean(
      hasCapability(workspaceRole, 'record.create') &&
      record &&
      record.status !== 'in_review' &&
      !record.lockedAt &&
      !record.archivedAt,
    ),
    enabled: !historicalRevisionId,
    describeOnly: record?.kind === 'protocol_template',
  })

  const shownPartNow = shownPart(partsList, requestedPart)

  const lockedPartGate =
    gatesHost.state?.gates.find(
      (gate) =>
        gate.kind === 'part' &&
        gate.partId === (shownPartNow?.id ?? null) &&
        !gate.met &&
        !gate.overridden,
    ) ?? null

  const nowPart = currentPart(partsList)

  const partSignoffs = usePartSignoffs(
    recordId,
    partsList.some((part) => part.requiresSignOff),
  )

  const partRequests = usePartRequests(recordId, currentUserId)

  const shownSignoff = shownPartNow
    ? partSignoffs.find((row) => row.partId === shownPartNow.id)
    : undefined

  const canvasBlocks = shownPartNow
    ? blocksOfPart(blocks, shownPartNow)
    : blocks

  const stepNumbers = useMemo(() => {
    const numbers = new Map<string, number>()

    if (partsList.length === 0) return numbers

    for (const step of stepProgress(blocks, undefined, partsList)) {
      if (step.partStepIndex != null)
        numbers.set(step.blockId, step.partStepIndex)
    }

    return numbers
  }, [blocks, partsList])

  return {
    partsView,
    partsList,
    requestedPart,
    shownPartNow,
    nowPart,
    lockedPartGate,
    gatesHost,
    shownSignoff,
    partRequests,
    canvasBlocks,
    stepNumbers,
    userLabelForParts: partNames.userLabel,
  }
}
