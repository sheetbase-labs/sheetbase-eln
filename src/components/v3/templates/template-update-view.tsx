import { useMemo, useState } from 'react'

import { Button } from '#/components/v3/ui/button'
import { Notice } from '#/components/v3/ui/alert'
import { Choice } from '#/components/v3/ui/choice'
import { RadioGroup } from '#/components/v3/ui/radio-group'
import { Muted, Section } from '#/components/v3/ui/layout'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { NativeSelect } from '#/components/v3/projects/select'
import { buildNotebookTemplateUpgradeDecisions } from '#/lib/notebook-template-upgrade'
import type {
  NotebookUpgradeDecision,
  NotebookUpgradeDecisionDraft,
  NotebookUpgradePreview,
  SheetDefinitionUpgradeDecisionDraft,
} from '#/lib/notebook-template-upgrade'

const AUTOMATIC_LABELS: Record<string, string> = {
  'placement-added': 'Section added',
  'placement-removed': 'Section removed',
  'sheet-definition-compatible':
    'Sheet re-pinned to a newer definition version',
}

const CONFLICT_LABELS: Record<string, string> = {
  'sheet-placement-unresolved': 'No matching sheet in this notebook',
  'sheet-definition-conflict': 'Sheet definition changed incompatibly',
}

const OUTCOME_LABELS: Record<string, { title: string; body: string }> = {
  keep: {
    title: 'Keep as it is',
    body: 'Leave this part on its current definition; nothing here changes.',
  },
  retarget: {
    title: 'Take the new definition',
    body: 'Update this part to the target version, resolving the fields below.',
  },
  'retain-local': {
    title: 'Keep the local column',
    body: 'The column leaves the definition but stays in this sheet.',
  },
  map: {
    title: 'Map to a new column',
    body: 'Point this column at a column in the new definition.',
  },
  defer: {
    title: 'Defer',
    body: 'Resolve later; the update cannot be applied while this is deferred.',
  },
}

type NestedDrafts = NonNullable<
  NotebookUpgradeDecisionDraft['instanceDecisionDrafts']
>

function defaultNestedDrafts(
  conflict: NotebookUpgradePreview['conflicts'][number],
): NestedDrafts {
  const drafts: NestedDrafts = {}
  for (const nested of conflict.instancePreview?.conflicts ?? []) {
    const chosen = nested.allowedOutcomes[0]
    drafts[nested.id] = {
      outcome: chosen,
      targetId: chosen === 'map' ? nested.targetCandidates[0] : undefined,
    }
  }
  return drafts
}

/** Seed every conflict with its first allowed outcome so the whole preview has
 * a complete, valid decision set before the owner touches anything. */
export function defaultNotebookUpgradeDrafts(
  preview: NotebookUpgradePreview,
): Record<string, NotebookUpgradeDecisionDraft> {
  const drafts: Record<string, NotebookUpgradeDecisionDraft> = {}
  for (const conflict of preview.conflicts) {
    drafts[conflict.id] = {
      outcome: conflict.allowedOutcomes[0],
      instanceDecisionDrafts: defaultNestedDrafts(conflict),
    }
  }
  return drafts
}

/**
 * SHEET-04.4: the per-notebook update view. It lists what the target version
 * would add or change, states every conflict with the outcomes the apply RPC
 * will accept, and applies the chosen decisions. The parent owns the RPC and
 * the query cache; a rejected apply is surfaced here, never as success.
 */
export function NotebookTemplateUpdateView({
  targetVersion,
  sourceVersion,
  templateName,
  notebookLabel,
  preview,
  isLoading,
  onApply,
  backLink,
}: {
  targetVersion: number
  sourceVersion?: number | null
  templateName?: string | null
  notebookLabel?: string | null
  preview: NotebookUpgradePreview | undefined
  isLoading: boolean
  onApply: (decisions: NotebookUpgradeDecision[]) => Promise<void>
  backLink: React.ReactNode
}) {
  const [choices, setChoices] = useState<
    Record<string, NotebookUpgradeDecisionDraft>
  >({})
  const [applying, setApplying] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const drafts = useMemo(() => {
    if (!preview) return {}
    const base = defaultNotebookUpgradeDrafts(preview)
    const merged: Record<string, NotebookUpgradeDecisionDraft> = {}
    for (const conflict of preview.conflicts) {
      merged[conflict.id] = {
        outcome: choices[conflict.id]?.outcome ?? base[conflict.id].outcome,
        instanceDecisionDrafts:
          choices[conflict.id]?.instanceDecisionDrafts ??
          base[conflict.id].instanceDecisionDrafts,
      }
    }
    return merged
  }, [preview, choices])

  const built = useMemo(() => {
    if (!preview)
      return { decisions: [] as NotebookUpgradeDecision[], problem: null }
    try {
      return {
        decisions: buildNotebookTemplateUpgradeDecisions(preview, drafts),
        problem: null,
      }
    } catch (cause) {
      return {
        decisions: [] as NotebookUpgradeDecision[],
        problem:
          cause instanceof Error
            ? cause.message
            : 'Choose an outcome for every conflict.',
      }
    }
  }, [preview, drafts])

  function chooseOutcome(conflictId: string, next: 'keep' | 'retarget') {
    setChoices((prev) => ({
      ...prev,
      [conflictId]: { ...prev[conflictId], outcome: next },
    }))
  }

  function chooseNested(
    conflictId: string,
    nestedId: string,
    next: 'retain-local' | 'map' | 'defer',
  ) {
    const conflict = preview?.conflicts.find((c) => c.id === conflictId)
    const nested = conflict?.instancePreview?.conflicts.find(
      (c) => c.id === nestedId,
    )
    const current = drafts[conflictId]?.instanceDecisionDrafts ?? {}
    const targetId =
      next === 'map'
        ? (current[nestedId]?.targetId ?? nested?.targetCandidates[0])
        : current[nestedId]?.targetId
    setChoices((prev) => ({
      ...prev,
      [conflictId]: {
        outcome: prev[conflictId]?.outcome ?? drafts[conflictId]?.outcome,
        instanceDecisionDrafts: {
          ...current,
          [nestedId]: { outcome: next, targetId },
        },
      },
    }))
  }

  function chooseNestedTarget(
    conflictId: string,
    nestedId: string,
    targetId: string,
  ) {
    const current = drafts[conflictId]?.instanceDecisionDrafts ?? {}
    setChoices((prev) => ({
      ...prev,
      [conflictId]: {
        outcome: prev[conflictId]?.outcome ?? drafts[conflictId]?.outcome,
        instanceDecisionDrafts: {
          ...current,
          [nestedId]: { ...current[nestedId], outcome: 'map', targetId },
        },
      },
    }))
  }

  async function submit() {
    setError(null)
    setApplying(true)
    try {
      await onApply(built.decisions)
      setDone(true)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The database refused the update.',
      )
    } finally {
      setApplying(false)
    }
  }

  if (!preview) {
    return (
      <div className="flex min-w-0 flex-col gap-5 px-4 py-4 md:px-6">
        <Muted>
          {isLoading
            ? 'Checking what the update would do…'
            : 'No preview available.'}
        </Muted>
      </div>
    )
  }

  const conflicts = preview.conflicts

  return (
    <div className="flex min-w-0 flex-col gap-5 px-4 py-4 md:px-6">
      {done ? (
        <Notice icon="check">
          <b className="font-semibold">Notebook updated to v{targetVersion}.</b>{' '}
          Recorded in its history as a template update. Existing text, rows and
          signatures were not touched.
        </Notice>
      ) : (
        <Notice>
          {notebookLabel ? (
            <b className="font-semibold">{notebookLabel}</b>
          ) : null}
          {sourceVersion != null
            ? ` is on template v${sourceVersion}. Version ${targetVersion} was published`
            : ` A newer template version (v${targetVersion}) is available`}
          {templateName ? ` — ${templateName}` : ''}. Nothing in this notebook
          has changed yet; applying adds the new placements and keeps everything
          the owner has written.
        </Notice>
      )}

      {error ? (
        <Notice tone="bad" title="Could not update the notebook">
          {error}
        </Notice>
      ) : null}

      <Section
        title={`What adding v${targetVersion} would do`}
        count={preview.automatic.length}
      >
        {preview.automatic.length ? (
          <TableBox>
            <Table aria-label="Automatic changes">
              <TableHeader>
                <TableRow>
                  <TableHead>Change</TableHead>
                  <TableHead>Placement</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.automatic.map((change, index) => (
                  <TableRow
                    key={`${change.kind}-${change.placementId ?? index}`}
                  >
                    <TableCell>
                      {AUTOMATIC_LABELS[change.kind] ??
                        change.kind.replace(/-/g, ' ')}
                    </TableCell>
                    <TableCell className="mono text-fg-muted">
                      {change.placementId
                        ? change.placementId.slice(0, 8)
                        : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableBox>
        ) : (
          <Muted>No automatic changes.</Muted>
        )}
      </Section>

      {conflicts.length ? (
        <Section title="Needs a decision" count={conflicts.length}>
          <div className="flex flex-col gap-3">
            {conflicts.map((conflict) => {
              const selected =
                drafts[conflict.id]?.outcome ?? conflict.allowedOutcomes[0]
              const nestedConflicts = conflict.instancePreview?.conflicts ?? []
              return (
                <div
                  key={conflict.id}
                  className="flex flex-col gap-2 rounded-md border border-border p-3"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="font-medium text-fg">
                      {CONFLICT_LABELS[conflict.kind] ??
                        conflict.kind.replace(/-/g, ' ')}
                    </span>
                    <span className="mono text-label text-fg-muted">
                      {conflict.placementId
                        ? conflict.placementId.slice(0, 8)
                        : conflict.id}
                    </span>
                  </div>
                  <RadioGroup
                    aria-label={
                      CONFLICT_LABELS[conflict.kind] ??
                      conflict.kind.replace(/-/g, ' ')
                    }
                    value={selected}
                    onValueChange={(value) =>
                      chooseOutcome(conflict.id, value as 'keep' | 'retarget')
                    }
                  >
                    {conflict.allowedOutcomes.map((o) => (
                      <Choice
                        key={o}
                        value={o}
                        title={OUTCOME_LABELS[o]?.title ?? o}
                      >
                        {OUTCOME_LABELS[o]?.body}
                      </Choice>
                    ))}
                  </RadioGroup>
                  {selected === 'retarget' && nestedConflicts.length ? (
                    <div className="flex flex-col gap-3 border-l-2 border-border pl-3">
                      {nestedConflicts.map((nested) => {
                        const nestedDraft =
                          drafts[conflict.id]?.instanceDecisionDrafts?.[
                            nested.id
                          ]
                        const nestedSelected =
                          nestedDraft?.outcome ?? nested.allowedOutcomes[0]
                        return (
                          <div
                            key={nested.id}
                            className="flex flex-col gap-1.5"
                          >
                            <span className="text-label text-fg-muted">
                              {CONFLICT_LABELS[nested.kind] ??
                                nested.kind.replace(/-/g, ' ')}
                            </span>
                            <RadioGroup
                              aria-label={
                                CONFLICT_LABELS[nested.kind] ??
                                nested.kind.replace(/-/g, ' ')
                              }
                              value={nestedSelected}
                              onValueChange={(value) =>
                                chooseNested(
                                  conflict.id,
                                  nested.id,
                                  value as SheetDefinitionUpgradeDecisionDraft['outcome'] &
                                    string,
                                )
                              }
                            >
                              {nested.allowedOutcomes.map((o) => (
                                <Choice
                                  key={o}
                                  value={o}
                                  title={OUTCOME_LABELS[o]?.title ?? o}
                                >
                                  {OUTCOME_LABELS[o]?.body}
                                </Choice>
                              ))}
                            </RadioGroup>
                            {nestedSelected === 'map' ? (
                              <NativeSelect
                                aria-label={`Target column for ${nested.id}`}
                                value={
                                  nestedDraft?.targetId ??
                                  nested.targetCandidates[0] ??
                                  ''
                                }
                                onChange={(event) =>
                                  chooseNestedTarget(
                                    conflict.id,
                                    nested.id,
                                    event.target.value,
                                  )
                                }
                              >
                                {nested.targetCandidates.map((candidate) => (
                                  <option key={candidate} value={candidate}>
                                    {candidate.slice(0, 8)}
                                  </option>
                                ))}
                              </NativeSelect>
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </Section>
      ) : null}

      {built.problem && !done ? (
        <Notice tone="warn">{built.problem}</Notice>
      ) : null}

      {!done ? (
        <div className="flex gap-2 max-md:flex-col">
          <Button
            variant="primary"
            disabled={applying || built.problem != null}
            onClick={() => void submit()}
          >
            {applying ? 'Applying…' : `Apply v${targetVersion}`}
          </Button>
          {backLink}
        </div>
      ) : (
        <div className="flex gap-2 max-md:flex-col">{backLink}</div>
      )}

      <Muted>
        Applying is recorded in the notebook's history as a template update.
        Existing text, rows and signatures are never touched by a template
        update. Signed records cannot be updated; use an amendment.
      </Muted>
    </div>
  )
}
