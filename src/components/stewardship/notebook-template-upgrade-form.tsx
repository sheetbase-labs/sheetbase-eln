import { Field, FieldLabel, Input, Select } from '#/components/ui'
import { TemplateParameterInputs } from '#/components/templates/template-parameter-inputs'
import type { DataClient } from '#/lib/data-client'
import type { NotebookTemplateConfiguration } from '#/lib/notebook-template'
import { buildParameterInputs } from '#/lib/parameter-input'
import type {
  NotebookUpgradeDecisionDraft,
  NotebookUpgradePreview,
} from '#/lib/notebook-template-upgrade'
import { buildNotebookTemplateUpgradeDecisions } from '#/lib/notebook-template-upgrade'
import { SheetDefinitionUpgradeForm } from '#/components/stewardship/sheet-definition-upgrade-form'

function mappedTemplateParameterIds(
  configuration: NotebookTemplateConfiguration,
): Set<string> {
  const ids = new Set<string>()
  for (const placement of configuration.placements) {
    if (placement.kind !== 'sheet') continue
    for (const mapping of placement.parameterMappings)
      ids.add(mapping.templateParameterId)
  }
  return ids
}

export function NotebookTemplateUpgradeForm({
  preview,
  targetConfiguration,
  decisionDrafts,
  parameterDrafts,
  onDecisionChange,
  onParameterChange,
  disabled = false,
  client,
  workspaceId,
}: {
  preview: NotebookUpgradePreview
  targetConfiguration: NotebookTemplateConfiguration
  decisionDrafts: Partial<Record<string, NotebookUpgradeDecisionDraft>>
  parameterDrafts: Record<string, string>
  onDecisionChange: (
    conflictId: string,
    draft: NotebookUpgradeDecisionDraft,
  ) => void
  onParameterChange: (parameterId: string, value: string) => void
  disabled?: boolean
  /**
   * REUSE-02: enables contract-checked parameter selectors (same
   * record/dataset exact-lineage-semantic vocabulary as instantiation).
   */
  client?: DataClient
  workspaceId?: string
}) {
  const mappedParameterIds = mappedTemplateParameterIds(targetConfiguration)
  const templateParameters = targetConfiguration.parameters.filter(
    (parameter) => mappedParameterIds.has(parameter.id),
  )

  return (
    <div className="space-y-3 rounded-md border p-3">
      <p className="text-xs text-muted-foreground">
        {preview.automatic.length} automatic change(s),{' '}
        {preview.conflicts.length} conflict(s).
      </p>
      {preview.automatic.length ? (
        <ul className="space-y-1 text-xs">
          {preview.automatic.map((change, index) => (
            <li key={`${change.kind}:${change.placementId ?? index}`}>
              {change.kind}
              {change.placementId ? ` · ${change.placementId}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
      {preview.conflicts.length ? (
        <div className="space-y-2">
          <p className="text-xs font-medium">Conflicts</p>
          {preview.conflicts.map((conflict) => {
            const draft = decisionDrafts[conflict.id] ?? {}
            const inputId = `template-upgrade-conflict-${conflict.id}`
            const instancePreview = conflict.instancePreview
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
                        | NonNullable<NotebookUpgradeDecisionDraft['outcome']>
                        | ''
                      if (!outcome) return
                      onDecisionChange(conflict.id, {
                        ...draft,
                        outcome,
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
                {draft.outcome === 'retarget' && instancePreview ? (
                  <SheetDefinitionUpgradeForm
                    preview={instancePreview}
                    targetParameters={[]}
                    decisionDrafts={draft.instanceDecisionDrafts ?? {}}
                    parameterDrafts={draft.instanceParameterDrafts ?? {}}
                    disabled={disabled}
                    client={client}
                    workspaceId={workspaceId}
                    onDecisionChange={(nestedConflictId, nestedDraft) =>
                      onDecisionChange(conflict.id, {
                        ...draft,
                        outcome: 'retarget',
                        instanceDecisionDrafts: {
                          ...(draft.instanceDecisionDrafts ?? {}),
                          [nestedConflictId]: nestedDraft,
                        },
                      })
                    }
                    onParameterChange={(parameterId, value) =>
                      onDecisionChange(conflict.id, {
                        ...draft,
                        outcome: 'retarget',
                        instanceParameterDrafts: {
                          ...(draft.instanceParameterDrafts ?? {}),
                          [parameterId]: value,
                        },
                      })
                    }
                  />
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}
      {templateParameters.length ? (
        client && workspaceId ? (
          <TemplateParameterInputs
            client={client}
            workspaceId={workspaceId}
            parameters={templateParameters}
            values={parameterDrafts}
            onChange={onParameterChange}
            disabled={disabled}
            heading="Mapped template parameters"
          />
        ) : (
          <div className="space-y-2">
            <p className="text-xs font-medium">Template parameters</p>
            {templateParameters.map((parameter) => (
              <Field key={parameter.id}>
                <FieldLabel
                  htmlFor={`template-upgrade-parameter-${parameter.id}`}
                >
                  {parameter.label}
                </FieldLabel>
                <Input
                  id={`template-upgrade-parameter-${parameter.id}`}
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

export function collectNotebookTemplateUpgradeInputs(
  preview: NotebookUpgradePreview,
  targetConfiguration: NotebookTemplateConfiguration,
  decisionDrafts: Partial<Record<string, NotebookUpgradeDecisionDraft>>,
  parameterDrafts: Record<string, string>,
) {
  const mappedParameterIds = mappedTemplateParameterIds(targetConfiguration)
  const templateParameters = targetConfiguration.parameters.filter(
    (parameter) => mappedParameterIds.has(parameter.id),
  )
  return {
    decisions: buildNotebookTemplateUpgradeDecisions(preview, decisionDrafts),
    parameterInputs: buildParameterInputs(templateParameters, parameterDrafts),
  }
}
