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
import { Select } from '#/components/v3/ui/select'
import { buildNotebookTemplateUpgradeDecisions } from '#/lib/notebook-template-upgrade'
import type {
  NotebookUpgradeDecision,
  NotebookUpgradeDecisionDraft,
  NotebookUpgradePreview,
  SheetDefinitionUpgradeDecisionDraft,
} from '#/lib/notebook-template-upgrade'
import { rich, t } from '#/copy'

const AUTOMATIC_LABELS: Record<string, string> = {
  'placement-added': t('library.templates.templateUpdateView.sectionAdded'),
  'placement-removed': t('library.templates.templateUpdateView.sectionRemoved'),
  'sheet-definition-compatible': t(
    'library.templates.templateUpdateView.sheetRePinnedToA',
  ),
}

const CONFLICT_LABELS: Record<string, string> = {
  'sheet-placement-unresolved': t(
    'library.templates.templateUpdateView.noMatchingSheetInThis',
  ),
  'sheet-definition-conflict': t(
    'library.templates.templateUpdateView.sheetDefinitionChangedIncompatibly',
  ),
}

const OUTCOME_LABELS: Record<
  string,
  { title: string; body: string } | undefined
> = {
  keep: {
    title: t('library.templates.templateUpdateView.keepAsItIs'),
    body: t('library.templates.templateUpdateView.leaveThisPartOnIts'),
  },
  retarget: {
    title: t('library.templates.templateUpdateView.takeTheNewDefinition'),
    body: t('library.templates.templateUpdateView.updateThisPartToThe'),
  },
  'retain-local': {
    title: t('library.templates.templateUpdateView.keepTheLocalColumn'),
    body: t(
      'library.templates.templateUpdateView.theColumnLeavesTheDefinition',
    ),
  },
  map: {
    title: t('library.templates.templateUpdateView.mapToANewColumn'),
    body: t('library.templates.templateUpdateView.pointThisColumnAtA'),
  },
  defer: {
    title: t('library.templates.templateUpdateView.defer'),
    body: t('library.templates.templateUpdateView.resolveLaterTheUpdateCannot'),
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
  lockedNotice,
}: {
  targetVersion: number
  sourceVersion?: number | null
  templateName?: string | null
  notebookLabel?: string | null
  preview: NotebookUpgradePreview | undefined
  isLoading: boolean
  onApply: (decisions: NotebookUpgradeDecision[]) => Promise<void>
  backLink: React.ReactNode
  /** Set when the notebook is signed: Apply is off and this says what to do. */
  lockedNotice?: React.ReactNode
}) {
  const [choices, setChoices] = useState<
    Record<string, NotebookUpgradeDecisionDraft | undefined>
  >({})
  const [applying, setApplying] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const drafts = useMemo(() => {
    if (!preview) return {}
    const base = defaultNotebookUpgradeDrafts(preview)
    const merged: Record<string, NotebookUpgradeDecisionDraft | undefined> = {}
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
            : t('library.templates.templateUpdateView.chooseAnOutcomeForEvery'),
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
          : t(
              'library.templates.templateUpdateView.theDatabaseRefusedTheUpdate',
            ),
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
            ? t(
                'library.templates.templateUpdateView.checkingWhatTheUpdateWould',
              )
            : t('library.templates.templateUpdateView.noPreviewAvailable')}
        </Muted>
      </div>
    )
  }

  const conflicts = preview.conflicts

  return (
    <div className="flex min-w-0 flex-col gap-5 px-4 py-4 md:px-6">
      {done ? (
        <Notice icon="check">
          {rich(
            'library.templates.templateUpdateView.notebookUpdatedToVRecorded',
            {
              targetVersion,
              b: (text) => <b className="font-semibold">{text}</b>,
            },
          )}
        </Notice>
      ) : (
        <Notice>
          {sourceVersion != null && notebookLabel
            ? rich(
                'library.templates.templateUpdateView.isOnTemplateVVersion',
                {
                  b: (text) => <b className="font-semibold">{text}</b>,
                  notebook: notebookLabel,
                  sourceVersion,
                  targetVersion,
                  template: templateName ? ` — ${templateName}` : '',
                },
              )
            : t('library.templates.templateUpdateView.aNewerTemplateVersionV', {
                targetVersion,
                template: templateName ? ` — ${templateName}` : '',
              })}
        </Notice>
      )}

      {lockedNotice && !done ? (
        <Notice
          tone="warn"
          title={t('library.templates.templateUpdateView.thisNotebookIsSigned')}
        >
          {lockedNotice}
        </Notice>
      ) : null}

      {error ? (
        <Notice
          tone="bad"
          title={t(
            'library.templates.templateUpdateView.couldNotUpdateTheNotebook',
          )}
        >
          {error}
        </Notice>
      ) : null}

      <Section
        title={t('library.templates.templateUpdateView.whatAddingVWouldDo', {
          targetVersion,
        })}
        count={preview.automatic.length}
      >
        {preview.automatic.length ? (
          <TableBox>
            <Table
              aria-label={t(
                'library.templates.templateUpdateView.automaticChanges',
              )}
            >
              <TableHeader>
                <TableRow>
                  <TableHead>
                    {t('library.templates.templateUpdateView.change')}
                  </TableHead>
                  <TableHead>
                    {t('library.templates.templateUpdateView.placement')}
                  </TableHead>
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
          <Muted>
            {t('library.templates.templateUpdateView.noAutomaticChanges')}
          </Muted>
        )}
      </Section>

      {conflicts.length ? (
        <Section
          title={t('library.templates.templateUpdateView.needsADecision')}
          count={conflicts.length}
        >
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
                              <Select
                                aria-label={t(
                                  'library.templates.templateUpdateView.targetColumnFor',
                                  { id: nested.id },
                                )}
                                value={
                                  nestedDraft?.targetId ??
                                  nested.targetCandidates.at(0) ??
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
                              </Select>
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
            disabled={
              applying || built.problem != null || Boolean(lockedNotice)
            }
            onClick={() => void submit()}
          >
            {applying
              ? t('library.templates.templateUpdateView.applying')
              : t('library.templates.templateUpdateView.applyV', {
                  targetVersion,
                })}
          </Button>
          {backLink}
        </div>
      ) : (
        <div className="flex gap-2 max-md:flex-col">{backLink}</div>
      )}

      <Muted>
        {t('library.templates.templateUpdateView.applyingIsRecordedInThe')}
      </Muted>
    </div>
  )
}
