import { useMemo, useState } from 'react'

import { Button } from '#/components/ui/button'
import { Notice } from '#/components/ui/alert'
import { Choice } from '#/components/ui/choice'
import { RadioGroup } from '#/components/ui/radio-group'
import { Muted, Section } from '#/components/ui/layout'
import { TableBox } from '#/components/ui/table'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { Select } from '#/components/ui/select'
import { buildNotebookTemplateUpgradeDecisions } from '#/lib/notebook-template-upgrade'
import type {
  NotebookUpgradeDecision,
  NotebookUpgradeDecisionDraft,
  NotebookUpgradePreview,
  SheetDefinitionUpgradeDecisionDraft,
} from '#/lib/notebook-template-upgrade'
import { rich, t } from '#/copy'
import { defaultNotebookUpgradeDrafts } from './templates-data'

const AUTOMATIC_LABELS = new Map(
  Object.entries({
    'placement-added': t('library.templates.templateUpdateView.sectionAdded'),
    'placement-removed': t(
      'library.templates.templateUpdateView.sectionRemoved',
    ),
    'sheet-definition-compatible': t(
      'library.templates.templateUpdateView.sheetRePinnedToA',
    ),
  }),
)

const CONFLICT_LABELS = new Map([
  [
    'sheet-placement-unresolved',
    t('library.templates.templateUpdateView.noMatchingSheetInThis'),
  ],
  [
    'sheet-definition-conflict',
    t(
      'library.templates.templateUpdateView.sheetDefinitionChangedIncompatibly',
    ),
  ],
])

const OUTCOME_LABELS = new Map(
  Object.entries({
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
      body: t(
        'library.templates.templateUpdateView.resolveLaterTheUpdateCannot',
      ),
    },
  } satisfies Record<
    NonNullable<
      | NotebookUpgradeDecisionDraft['outcome']
      | SheetDefinitionUpgradeDecisionDraft['outcome']
    >,
    { title: string; body: string }
  >),
)

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

  const automatic = useMemo(() => {
    const occurrences = new Map<string, number>()

    return (preview?.automatic ?? []).map((change) => {
      const identity = `${change.kind}:${change.placementId ?? ''}:${change.instanceId ?? ''}:${change.blockId ?? ''}:${change.targetDefinitionVersionId ?? ''}`
      const occurrence = occurrences.get(identity) ?? 0
      occurrences.set(identity, occurrence + 1)

      return { change, key: `${identity}:${occurrence}` }
    })
  }, [preview])

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

  const built = useMemo<{
    decisions: NotebookUpgradeDecision[]
    problem: string | null
  }>(() => {
    if (!preview) return { decisions: [], problem: null }

    try {
      return {
        decisions: buildNotebookTemplateUpgradeDecisions(preview, drafts),
        problem: null,
      }
    } catch (cause) {
      return {
        decisions: [],
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
      <UpgradeStatus
        done={done}
        targetVersion={targetVersion}
        sourceVersion={sourceVersion}
        notebookLabel={notebookLabel}
        templateName={templateName}
      />

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

      <AutomaticChanges targetVersion={targetVersion} rows={automatic} />

      {conflicts.length ? (
        <Section
          title={t('library.templates.templateUpdateView.needsADecision')}
          count={conflicts.length}
        >
          <div className="flex flex-col gap-3">
            {conflicts.map((conflict) => (
              <UpgradeConflict
                key={conflict.id}
                conflict={conflict}
                draft={drafts[conflict.id]}
                chooseOutcome={chooseOutcome}
                chooseNested={chooseNested}
                chooseNestedTarget={chooseNestedTarget}
              />
            ))}
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

function UpgradeStatus({
  done,
  targetVersion,
  sourceVersion,
  notebookLabel,
  templateName,
}: {
  done: boolean
  targetVersion: number
  sourceVersion?: number | null
  notebookLabel?: string | null
  templateName?: string | null
}) {
  return done ? (
    <Notice icon="check">
      {rich('library.templates.templateUpdateView.notebookUpdatedToVRecorded', {
        targetVersion,
        b: (text) => <b className="font-semibold">{text}</b>,
      })}
    </Notice>
  ) : (
    <Notice>
      {sourceVersion != null && notebookLabel
        ? rich('library.templates.templateUpdateView.isOnTemplateVVersion', {
            b: (text) => <b className="font-semibold">{text}</b>,
            notebook: notebookLabel,
            sourceVersion,
            targetVersion,
            template: templateName ? ` — ${templateName}` : '',
          })
        : t('library.templates.templateUpdateView.aNewerTemplateVersionV', {
            targetVersion,
            template: templateName ? ` — ${templateName}` : '',
          })}
    </Notice>
  )
}

type AutomaticRow = {
  change: NotebookUpgradePreview['automatic'][number]
  key: string
}

const AUTOMATIC_COLUMNS: RegistryColumn<AutomaticRow>[] = [
  {
    id: 'change',
    header: t('library.templates.templateUpdateView.change'),
    accessorFn: ({ change }) =>
      AUTOMATIC_LABELS.get(change.kind) ?? change.kind.replace(/-/g, ' '),
  },
  {
    id: 'placement',
    header: t('library.templates.templateUpdateView.placement'),
    accessorFn: ({ change }) =>
      change.placementId ? change.placementId.slice(0, 8) : '—',
    meta: { cellClassName: 'mono text-fg-muted' },
  },
]

function AutomaticChanges({
  targetVersion,
  rows,
}: {
  targetVersion: number
  rows: AutomaticRow[]
}) {
  return (
    <Section
      title={t('library.templates.templateUpdateView.whatAddingVWouldDo', {
        targetVersion,
      })}
      count={rows.length}
    >
      {rows.length ? (
        <TableBox>
          <RegistryGrid
            label={t('library.templates.templateUpdateView.automaticChanges')}
            rows={rows}
            columns={AUTOMATIC_COLUMNS}
            getRowId={(row) => row.key}
            selectable={false}
          />
        </TableBox>
      ) : (
        <Muted>
          {t('library.templates.templateUpdateView.noAutomaticChanges')}
        </Muted>
      )}
    </Section>
  )
}

function UpgradeConflict({
  conflict,
  draft,
  chooseOutcome,
  chooseNested,
  chooseNestedTarget,
}: {
  conflict: NotebookUpgradePreview['conflicts'][number]
  draft: NotebookUpgradeDecisionDraft | undefined
  chooseOutcome: (id: string, next: 'keep' | 'retarget') => void
  chooseNested: (
    id: string,
    nestedId: string,
    next: 'retain-local' | 'map' | 'defer',
  ) => void
  chooseNestedTarget: (id: string, nestedId: string, targetId: string) => void
}) {
  const selected = draft?.outcome ?? conflict.allowedOutcomes[0]
  const nestedConflicts = conflict.instancePreview?.conflicts ?? []

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="flex items-baseline gap-2">
        <span className="font-medium text-fg">
          {CONFLICT_LABELS.get(conflict.kind) ??
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
          CONFLICT_LABELS.get(conflict.kind) ?? conflict.kind.replace(/-/g, ' ')
        }
        value={selected}
        onValueChange={(value) => {
          const outcome = conflict.allowedOutcomes.find(
            (entry) => entry === value,
          )

          if (outcome) chooseOutcome(conflict.id, outcome)
        }}
      >
        {conflict.allowedOutcomes.map((o) => (
          <Choice key={o} value={o} title={OUTCOME_LABELS.get(o)?.title ?? o}>
            {OUTCOME_LABELS.get(o)?.body}
          </Choice>
        ))}
      </RadioGroup>
      {selected === 'retarget' && nestedConflicts.length ? (
        <div className="flex flex-col gap-3 border-l-2 border-border pl-3">
          {nestedConflicts.map((nested) => {
            const nestedDraft = draft?.instanceDecisionDrafts?.[nested.id]

            const nestedSelected =
              nestedDraft?.outcome ?? nested.allowedOutcomes[0]

            return (
              <div key={nested.id} className="flex flex-col gap-1.5">
                <span className="text-label text-fg-muted">
                  {CONFLICT_LABELS.get(nested.kind) ??
                    nested.kind.replace(/-/g, ' ')}
                </span>
                <RadioGroup
                  aria-label={
                    CONFLICT_LABELS.get(nested.kind) ??
                    nested.kind.replace(/-/g, ' ')
                  }
                  value={nestedSelected}
                  onValueChange={(value) => {
                    const outcome = nested.allowedOutcomes.find(
                      (entry) => entry === value,
                    )

                    if (outcome) chooseNested(conflict.id, nested.id, outcome)
                  }}
                >
                  {nested.allowedOutcomes.map((o) => (
                    <Choice
                      key={o}
                      value={o}
                      title={OUTCOME_LABELS.get(o)?.title ?? o}
                    >
                      {OUTCOME_LABELS.get(o)?.body}
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
}
