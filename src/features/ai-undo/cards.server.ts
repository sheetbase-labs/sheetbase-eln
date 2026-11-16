import { toolDef } from '#/lib/assistant-lab-tools.server'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import { parse } from '#/lib/assistant-upkeep.server'
import type {
  AssistantProposal,
  ProposalChange,
} from '#/lib/assistant-proposals'
import type { ProviderToolDef } from '#/lib/ai-providers/types'

import { previewUndo } from './client'
import {
  CHANGES_PROPOSE_TOOL_NAMES,
  CHANGES_RECENT_TOOL,
  CHANGES_UNDO_TOOL,
  blockedWords,
  proposeUndoSchema,
  recentChangesSchema,
  setRowSchema,
} from './undo'
import type { ChangeSetRow, UndoAction, UndoPreview } from './undo'

/**
 * The undo cards and the read that finds what can be undone (see
 * `assistant.ts`). The builder previews as the signed-in person, so what comes
 * back is what undoing would do right now; the button runs the ordinary RPC.
 */

export type ChangesOutcome =
  { ok: true; proposal: AssistantProposal } | { ok: false; message: string }

const NOTE =
  'The person sees a card with exactly what would be put back and presses a button to do it; nothing changes until they do.'

export function isChangesProposalTool(name: string): boolean {
  return CHANGES_PROPOSE_TOOL_NAMES.some((tool) => tool === name)
}

export function isChangesReadTool(name: string): boolean {
  return name === CHANGES_RECENT_TOOL
}

export function changesProposalDefs(): ProviderToolDef[] {
  return [
    toolDef(
      CHANGES_UNDO_TOOL,
      `Propose undoing what the assistant changed: everything one earlier card or plan made or edited is put back, all or nothing. Use it when the person says to undo, revert, roll back or take back what you just did. Records and projects it made are archived, bookings cancelled, notebook blocks it added removed and fields it edited restored. It is refused, with the reason, when anything was signed, locked, submitted for review or changed by someone since, or cannot be taken back. Leave changeSetId out to undo the latest set; call ${CHANGES_RECENT_TOOL} first when the person means an earlier one. ${NOTE}`,
      proposeUndoSchema,
    ),
  ]
}

export function changesReadDefs(): ProviderToolDef[] {
  return [
    toolDef(
      CHANGES_RECENT_TOOL,
      'Read what the assistant changed for the person recently (newest first), and for each whether it can still be undone and, if not, why not. Use it before proposing an undo when the person does not mean the latest change.',
      recentChangesSchema,
    ),
  ]
}

async function recentSets(
  context: LabToolContext,
  limit: number,
): Promise<ChangeSetRow[]> {
  const rows = await context.client.list<unknown>(
    'ai_change_sets',
    `?workspace_id=eq.${context.workspaceId}&status=neq.open&order=created_at.desc&limit=${limit}`,
  )

  return rows.flatMap((row) => {
    const parsed = setRowSchema.safeParse(row)

    return parsed.success ? [parsed.data] : []
  })
}

function summarise(preview: UndoPreview): string[] {
  return preview.items
    .filter((item) => item.state !== 'already')
    .map(
      (item) =>
        `${item.state === 'blocked' ? 'Stays' : item.verb}: ${item.label}`,
    )
}

export async function runChangesReadTool(
  _name: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw tool input is checked by recentChangesSchema before use.
  args: unknown,
  context: LabToolContext,
): Promise<{ text: string; isError: boolean }> {
  const parsed = recentChangesSchema.safeParse(args)

  if (!parsed.success) {
    return { text: 'The limit must be a number from 1 to 20.', isError: true }
  }

  try {
    const sets = await recentSets(context, parsed.data.limit ?? 8)

    const items = await Promise.all(
      sets.map(async (set) => {
        if (set.status === 'undone') {
          return {
            id: set.id,
            title: set.title,
            kind: set.kind,
            status: 'undone',
          }
        }

        const preview = await previewUndo(context.client, set.id)

        return {
          id: set.id,
          title: set.title,
          kind: set.kind,
          status: set.status,
          createdAt: set.created_at,
          canUndo: preview.canUndo,
          wouldChange: summarise(preview),
          stopsIt: blockedWords(preview),
        }
      }),
    )

    return {
      text: JSON.stringify({ items, returned: items.length }),
      isError: false,
    }
  } catch {
    return { text: 'Could not read recent changes.', isError: true }
  }
}

function changesFrom(preview: UndoPreview): ProposalChange[] {
  return preview.items
    .filter((item) => item.state === 'ok')
    .map((item) => {
      if (item.kind === 'fields') {
        const fields = item.changes ?? []

        return {
          label: item.label,
          before: fields
            .map((change) => `${change.field}: ${change.to ?? 'empty'}`)
            .join(', '),
          after: fields
            .map((change) => `${change.field}: ${change.from ?? 'empty'}`)
            .join(', '),
        }
      }

      const [before, after] =
        item.kind === 'booking'
          ? ['Booked', 'Cancelled']
          : item.kind === 'block'
            ? ['In the notebook', 'Removed']
            : ['Active', 'Archived']

      return { label: item.label, before, after }
    })
}

export async function buildChangesProposal(
  name: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Each tool case parses raw input before using it.
  args: unknown,
  context: LabToolContext,
): Promise<ChangesOutcome> {
  if (name !== CHANGES_UNDO_TOOL) return { ok: false, message: 'Unknown tool.' }
  const parsed = parse(proposeUndoSchema, args)

  if (!parsed.ok) return { ok: false, message: parsed.message }
  const input = parsed.data

  try {
    let target: ChangeSetRow | undefined

    if (input.changeSetId) {
      const rows = await context.client.list<unknown>(
        'ai_change_sets',
        `?id=eq.${input.changeSetId}&limit=1`,
      )

      const row = setRowSchema.safeParse(rows.at(0))

      target = row.success ? row.data : undefined
    } else {
      target = (await recentSets(context, 8)).find(
        (set) => set.status === 'applied',
      )
    }

    if (!target || target.status === 'undone') {
      return {
        ok: false,
        message:
          'There is nothing to undo: no earlier change of the assistant is waiting.',
      }
    }

    const preview = await previewUndo(context.client, target.id)

    if (!preview.canUndo) {
      const why = blockedWords(preview)

      return {
        ok: false,
        message: why.length
          ? `"${preview.title}" cannot be undone, so nothing was touched. ${why.join(' ')}`
          : `"${preview.title}" has nothing left to undo.`,
      }
    }

    const action: UndoAction = {
      kind: 'changes.undo',
      workspaceId: context.workspaceId,
      changeSetId: target.id,
    }

    return {
      ok: true,
      proposal: {
        tool: CHANGES_UNDO_TOOL,
        title: input.title,
        summary: input.summary,
        target: preview.title,
        deepLink: null,
        changes: changesFrom(preview),
        action,
      },
    }
  } catch {
    return { ok: false, message: 'Could not check what can be undone.' }
  }
}
