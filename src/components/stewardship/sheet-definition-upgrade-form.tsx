import { Field, FieldLabel, Input, Select } from '#/components/ui'
import { TemplateParameterInputs } from '#/components/templates/template-parameter-inputs'
import type { DataClient } from '#/lib/data-client'
import type { Parameter } from '#/lib/parameter'
import { buildParameterInputs } from '#/lib/parameter-input'
import type { SheetDefinitionUpgradeDecisionDraft } from '#/lib/notebook-template-upgrade'
import { requiredTargetParameterIds } from '#/lib/notebook-template-upgrade'
import { summarizeSheetDefinitionUpgradeImpact } from '#/lib/reuse-upgrade'
import type { SheetDefinitionUpgradePreview } from '#/lib/sheet-definition-upgrade'

export function SheetDefinitionUpgradeForm({
  preview,
  targetParameters,
  decisionDrafts,
  parameterDrafts,
  onDecisionChange,
  onParameterChange,
  disabled = false,
  client,
  workspaceId,
}: {
  preview: SheetDefinitionUpgradePreview
  targetParameters: Parameter[]
  decisionDrafts: Partial<Record<string, SheetDefinitionUpgradeDecisionDraft>>
  parameterDrafts: Record<string, string>
  onDecisionChange: (
    conflictId: string,
    draft: SheetDefinitionUpgradeDecisionDraft,
  ) => void
  onParameterChange: (parameterId: string, value: string) => void
  disabled?: boolean
  /**
   * REUSE-02: when a governed data client and workspace are available, the
   * target source bindings resolve through the same record/dataset
   * exact-lineage-semantic contract checks as Template instantiation.
   * Without them the form falls back to raw object-ID inputs.
   */
  client?: DataClient
  workspaceId?: string
}) {
  const impact = summarizeSheetDefinitionUpgradeImpact(preview)
  const requiredParameterIds = new Set(requiredTargetParameterIds(preview))
  const parametersToCollect = targetParameters.filter(
    (parameter) =>
      requiredParameterIds.has(parameter.id) ||
      (parameter.required &&
        preview.conflicts.some(
          (conflict) =>
            conflict.kind.startsWith('parameter-') &&
            conflict.sourceId === parameter.id,
        )),
  )

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="space-y-1">
        <p className="text-xs font-medium">{impact.title}</p>
        <ul className="space-y-1 text-xs text-muted-foreground">
          {impact.lines.map((line, index) => (
            <li key={`change-${index}`}>{line}</li>
          ))}
          {impact.localEffects.map((effect, index) => (
            <li key={`local-${index}`}>{effect}</li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-muted-foreground">
        {preview.automaticChanges.length} automatic change(s),{' '}
        {preview.conflicts.length} conflict(s).
      </p>
      {preview.automaticChanges.length ? (
        <ul className="space-y-1 text-xs">
          {preview.automaticChanges.map((change) => (
            <li key={`${change.kind}:${change.objectId}`}>
              {change.kind} · {change.objectId}
            </li>
          ))}
        </ul>
      ) : null}
      {preview.conflicts.length ? (
        <div className="space-y-2">
          <p className="text-xs font-medium">Conflicts</p>
          {preview.conflicts.map((conflict) => {
            const draft = decisionDrafts[conflict.id] ?? {}
            const inputId = `upgrade-conflict-${conflict.id}`
            return (
              <div
                key={conflict.id}
                className="space-y-2 rounded border border-dashed p-2"
              >
                <p className="font-mono text-xs">{conflict.id}</p>
                <p className="text-xs text-muted-foreground">{conflict.kind}</p>
                <Field>
                  <FieldLabel htmlFor={inputId}>Outcome</FieldLabel>
                  <Select
                    id={inputId}
                    value={draft.outcome ?? ''}
                    disabled={disabled}
                    onChange={(event) => {
                      const outcome = event.target.value as
                        | NonNullable<
                            SheetDefinitionUpgradeDecisionDraft['outcome']
                          >
                        | ''
                      if (!outcome) return
                      onDecisionChange(conflict.id, {
                        outcome,
                        targetId:
                          outcome === 'map'
                            ? (draft.targetId ?? conflict.targetCandidates[0])
                            : undefined,
                      })
                    }}
                  >
                    <option value="">Select an outcome</option>
                    {conflict.allowedOutcomes.map((outcome) => (
                      <option key={outcome} value={outcome}>
                        {outcome}
                      </option>
                    ))}
                  </Select>
                </Field>
                {draft.outcome === 'map' && conflict.targetCandidates.length ? (
                  <Field>
                    <FieldLabel htmlFor={`${inputId}-target`}>
                      Target object
                    </FieldLabel>
                    <Select
                      id={`${inputId}-target`}
                      value={draft.targetId ?? ''}
                      disabled={disabled}
                      onChange={(event) =>
                        onDecisionChange(conflict.id, {
                          ...draft,
                          outcome: 'map',
                          targetId: event.target.value,
                        })
                      }
                    >
                      <option value="">Select a target</option>
                      {conflict.targetCandidates.map((candidate) => (
                        <option key={candidate} value={candidate}>
                          {candidate}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}
      {parametersToCollect.length ? (
        client && workspaceId ? (
          <TemplateParameterInputs
            client={client}
            workspaceId={workspaceId}
            parameters={parametersToCollect}
            values={parameterDrafts}
            onChange={onParameterChange}
            disabled={disabled}
            heading="Target source bindings"
          />
        ) : (
          <div className="space-y-2">
            <p className="text-xs font-medium">Target parameters</p>
            {parametersToCollect.map((parameter) => (
              <Field key={parameter.id}>
                <FieldLabel htmlFor={`upgrade-parameter-${parameter.id}`}>
                  {parameter.label}
                </FieldLabel>
                <Input
                  id={`upgrade-parameter-${parameter.id}`}
                  value={parameterDrafts[parameter.id] ?? ''}
                  disabled={disabled}
                  onChange={(event) =>
                    onParameterChange(parameter.id, event.target.value)
                  }
                  placeholder={
                    parameter.type.kind === 'scalar'
                      ? 'Enter a value'
                      : 'Enter object ID'
                  }
                />
              </Field>
            ))}
          </div>
        )
      ) : null}
    </div>
  )
}

export function collectSheetDefinitionUpgradeInputs(
  preview: SheetDefinitionUpgradePreview,
  targetParameters: Parameter[],
  decisionDrafts: Partial<Record<string, SheetDefinitionUpgradeDecisionDraft>>,
  parameterDrafts: Record<string, string>,
) {
  const requiredIds = new Set(requiredTargetParameterIds(preview))
  const parameters = targetParameters.filter(
    (parameter) =>
      requiredIds.has(parameter.id) ||
      preview.conflicts.some(
        (conflict) =>
          conflict.kind.startsWith('parameter-') &&
          conflict.sourceId === parameter.id,
      ),
  )
  return {
    decisions: preview.conflicts.map((conflict) => {
      const draft = decisionDrafts[conflict.id]
      if (!draft || !draft.outcome)
        throw new Error(`Choose an outcome for conflict "${conflict.id}".`)
      if (!conflict.allowedOutcomes.includes(draft.outcome))
        throw new Error(`Outcome "${draft.outcome}" is not allowed.`)
      if (draft.outcome === 'map') {
        const targetId = draft.targetId?.trim()
        if (!targetId)
          throw new Error(`Choose a target for conflict "${conflict.id}".`)
        return { conflictId: conflict.id, outcome: 'map' as const, targetId }
      }
      return { conflictId: conflict.id, outcome: draft.outcome }
    }),
    parameterInputs: buildParameterInputs(parameters, parameterDrafts),
  }
}
