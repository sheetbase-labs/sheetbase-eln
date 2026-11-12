import { Muted } from '#/components/ui/layout'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { RecipeEditor } from '#/components/pipelines/simple/recipe-editor'
import { t } from '#/copy'
import { recipeOf } from '#/lib/pipelines/simple/compile'
import type { PipelineDefinitionVersionWire } from '#/lib/pipelines/types'

interface ShownStep {
  name?: string
  kind?: string
  statement?: string
  note?: string
}

/** One version as it was written: a recipe for a Simple one, its steps for the rest. */
export function ReadOnlyVersion({
  version,
}: {
  version: PipelineDefinitionVersionWire
}) {
  const recipe = recipeOf(version.configuration)

  if (recipe)
    return (
      <RecipeEditor
        recipe={recipe}
        onChange={() => undefined}
        onConvert={() => undefined}
        pipelineLabel={`v${version.version}`}
        ownerName={null}
        readOnly
      />
    )

  // SAFETY: the steps of a stored version are the contract's step objects; only name and kind are read.
  const steps: ShownStep[] = Array.isArray(version.configuration.steps)
    ? (version.configuration.steps as ShownStep[])
    : []

  if (steps.length === 0)
    return <Muted>{t('features.pipelineSimple.history.none')}</Muted>

  return (
    <TableBox>
      <Table caption={t('features.pipelineSimple.history.steps')}>
        <TableHeader>
          <TableRow>
            <TableHead>{t('features.pipelineSimple.history.steps')}</TableHead>
            <TableHead>{t('features.pipelineSimple.history.kind')}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {steps.map((step, index) => (
            <TableRow key={`${step.name}-${index}`}>
              <TableCell className="font-medium">{step.name}</TableCell>
              <TableCell className="text-fg-muted">{step.kind}</TableCell>
              <TableCell className="font-mono text-caption text-fg-muted">
                {step.statement?.slice(0, 120) ?? step.note ?? ''}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableBox>
  )
}
