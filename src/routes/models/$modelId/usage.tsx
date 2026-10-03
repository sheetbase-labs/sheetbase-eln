import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'

import { EmptyState } from '#/components/v3/ui/empty-state'
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
import { fetchModelFieldsWithUsage } from '#/lib/model-fields'
import {
  countActionableModelImpact,
  discoverModelImpact,
  groupModelImpact,
} from '#/lib/model-impact'
import { isUuid } from '#/lib/field-value-validation'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  useBuiltInModelKind,
  useWorkspaceRecordModel,
} from '#/components/v3/models/models-data'

/**
 * UI port (roadmap-4/ui-app3): the Usage tab shows where a record model is
 * referenced — field usage counts and the canonical dependency discovery — so
 * a steward can see the impact of changing the model.
 */
export const Route = createFileRoute('/models/$modelId/usage')({
  component: ModelUsage,
})

function ModelUsage() {
  const { modelId } = Route.useParams()
  if (isUuid(modelId)) {
    return (
      <div className="px-4 py-6 md:px-6">
        <EmptyState
          icon="schema"
          title="Usage applies to record models"
          body="This is a dataset schema. Usage counts how a record model is referenced across records, sheets and templates."
        />
      </div>
    )
  }
  return <RecordModelUsage modelKey={modelId} />
}

function RecordModelUsage({ modelKey }: { modelKey: string }) {
  const model = useWorkspaceRecordModel(modelKey)
  const builtIn = useBuiltInModelKind(modelKey)
  const fields = useQuery({
    queryKey: ['ui-port', 'record-models', 'field-usage', modelKey] as const,
    queryFn: () => fetchModelFieldsWithUsage(notebookDataClient, modelKey),
  })
  // `discover_model_dependencies` resolves built-in `model_kinds` only; a
  // workspace model key 403s. Gate the call rather than surface a spurious
  // error, and say so in the panel.
  const impactEnabled = Boolean(builtIn.data)
  const impact = useQuery({
    queryKey: ['ui-port', 'record-models', 'impact', modelKey] as const,
    queryFn: () => discoverModelImpact(notebookDataClient, modelKey),
    enabled: impactEnabled,
  })

  const fieldRows = fields.data ?? []
  const dependencies = impact.data?.dependencies ?? []
  const groups = groupModelImpact(dependencies)
  const actionable = countActionableModelImpact(dependencies)

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-auto px-4 py-4 md:px-6">
      <Section title="Fields" count={fieldRows.length}>
        <Muted>
          How many {model.data?.name ?? modelKey} records carry a value for each
          field. A field with no values can still be changed without rewriting
          records.
        </Muted>
        {fieldRows.length ? (
          <TableBox>
            <Table aria-label="Field usage">
              <TableHeader>
                <TableRow>
                  <TableHead>Field</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Lifecycle</TableHead>
                  <TableHead className="text-right">Values</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fieldRows.map((field) => (
                  <TableRow key={field.id}>
                    <TableCell className="font-medium">{field.label}</TableCell>
                    <TableCell className="text-fg-muted">
                      {field.logicalType}
                    </TableCell>
                    <TableCell className="text-fg-muted">
                      {field.lifecycle}
                    </TableCell>
                    <TableCell className="num text-right">
                      {field.usageCount}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableBox>
        ) : (
          <Muted>This model has no fields.</Muted>
        )}
      </Section>

      <Section title="Used by" count={dependencies.length}>
        <Muted>
          {actionable > 0
            ? `${actionable} dependent${actionable === 1 ? '' : 's'} would need handling before a breaking change.`
            : 'No dependent needs handling before a change.'}
        </Muted>
        {!impactEnabled ? (
          <Muted>
            Dependency discovery currently covers built-in model kinds.
            Workspace-model impact is not reported yet.
          </Muted>
        ) : groups.length ? (
          <div className="flex flex-col gap-3">
            {groups.map((group) => (
              <div key={group.group} className="flex flex-col gap-1">
                <h3 className="m-0 text-label font-semibold">
                  {group.title}{' '}
                  <span className="num text-fg-muted">
                    {group.items.length}
                  </span>
                </h3>
                <ul className="m-0 flex list-none flex-col gap-1 p-0 text-label">
                  {group.items.map((item) => (
                    <li key={`${item.kind}-${item.id}`}>
                      <span className="font-medium">{item.label}</span>{' '}
                      <span className="text-fg-muted">
                        · {item.kind} · {item.effect}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <Muted>Nothing references this model yet.</Muted>
        )}
      </Section>
    </div>
  )
}
