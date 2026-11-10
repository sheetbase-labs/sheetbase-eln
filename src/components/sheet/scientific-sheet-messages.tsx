import { SchemaBadge } from '#/components/dataset-schema/schema-badge'
import type { ScientificTableWire } from '#/lib/scientific-sheet-data'

export function ScientificSheetMessages({
  issues,
  calculationProblem,
  schema,
  readOnly,
  upgrading,
  onUpgrade,
}: {
  issues: Array<{ key: string; message: string }>
  calculationProblem: string | null
  schema: ScientificTableWire['dataset_schema']
  readOnly: boolean
  upgrading: boolean
  onUpgrade: (revision: number) => void
}) {
  const revision = schema?.latest_published_revision

  return (
    <>
      {issues.length ? (
        <ul
          role="alert"
          className="mb-2 space-y-0.5 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-danger-text"
        >
          {issues.map((issue) => (
            <li key={issue.key} data-cell={issue.key}>
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
      {calculationProblem ? (
        <p
          role="alert"
          className="mb-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-danger-text"
        >
          {calculationProblem}
        </p>
      ) : null}
      {schema ? (
        <div className="flex items-center justify-between px-1 pb-1.5">
          <SchemaBadge
            schema={schema}
            onUpgrade={
              readOnly || !revision ? undefined : () => onUpgrade(revision)
            }
            upgrading={upgrading}
          />
        </div>
      ) : null}
    </>
  )
}
