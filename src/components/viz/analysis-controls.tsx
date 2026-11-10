import { Select } from '#/components/ui/select'
import { t } from '#/copy'
import { COLUMN_TRANSFORMS, MAX_DEGREE } from '#/lib/analysis-definition'
import type {
  AnalysisDefinition,
  AnalysisFieldBinding,
} from '#/lib/analysis-definition'
import type { CanonicalDatasetSource } from '#/lib/chart-data'
import { ComparisonControls, SurvivalControls } from './analysis-comparison'

export type DefinitionPatch<Definition = AnalysisDefinition> =
  Definition extends AnalysisDefinition
    ? Partial<Omit<Definition, 'kind'>>
    : never

type Columns = CanonicalDatasetSource['columns']

type ChangeDefinition = (patch: DefinitionPatch) => void

function BindingControl({
  id,
  label,
  ariaLabel,
  binding,
  columns,
  emptyLabel,
  onChange,
}: {
  id: string
  label: string
  ariaLabel: string
  binding: AnalysisFieldBinding | null | undefined
  columns: Columns
  emptyLabel?: string
  onChange: (value: AnalysisFieldBinding | null | undefined) => void
}) {
  return (
    <div className="flex min-w-36 flex-1 flex-col gap-1">
      <label className="text-label text-fg-muted" htmlFor={id}>
        {label}
      </label>
      <Select
        id={id}
        aria-label={ariaLabel}
        size="sm"
        value={binding?.fieldId ?? ''}
        onChange={(event) => {
          const column = columns.find(
            (candidate) => candidate.id === event.target.value,
          )

          onChange(
            column ? { fieldId: column.id } : emptyLabel ? null : undefined,
          )
        }}
        className="bg-surface"
      >
        {emptyLabel ? <option value="">{emptyLabel}</option> : null}
        {columns.map((column) => (
          <option key={column.id} value={column.id}>
            {column.label}
          </option>
        ))}
      </Select>
    </div>
  )
}

function RegressionControls({
  definition,
  numeric,
  category,
  onChange,
}: {
  definition: Extract<AnalysisDefinition, { kind: 'regression' }>
  numeric: Columns
  category: Columns
  onChange: ChangeDefinition
}) {
  return (
    <>
      <BindingControl
        id="analysis-outcome"
        label={t('data.analysisPanel.outcomeY')}
        ariaLabel={t('data.analysisPanel.ariaOutcomeColumn')}
        binding={definition.outcome}
        columns={numeric}
        onChange={(outcome) => onChange({ outcome: outcome ?? undefined })}
      />
      <BindingControl
        id="analysis-predictor"
        label={t('data.analysisPanel.predictorX')}
        ariaLabel={t('data.analysisPanel.ariaPredictorColumn')}
        binding={definition.predictor}
        columns={numeric}
        onChange={(predictor) =>
          onChange({ predictor: predictor ?? undefined })
        }
      />
      <div className="flex min-w-24 flex-col gap-1">
        <label className="text-label text-fg-muted" htmlFor="analysis-degree">
          {t('data.analysisPanel.degree')}
        </label>
        <Select
          id="analysis-degree"
          aria-label={t('data.analysisPanel.ariaPolynomialDegree')}
          size="sm"
          value={String(definition.degree ?? 1)}
          onChange={(event) =>
            onChange({ degree: Math.max(1, Number(event.target.value) || 1) })
          }
          className="bg-surface"
        >
          {Array.from({ length: MAX_DEGREE }, (_, i) => i + 1).map((degree) => (
            <option key={degree} value={degree}>
              {degree}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex min-w-32 flex-col gap-1">
        <label
          className="text-label text-fg-muted"
          htmlFor="analysis-y-transform"
        >
          {t('data.analysisPanel.yTransform')}
        </label>
        <Select
          id="analysis-y-transform"
          aria-label={t('data.analysisPanel.ariaOutcomeTransform')}
          size="sm"
          value={definition.outcomeTransform ?? ''}
          onChange={(event) =>
            onChange({
              outcomeTransform: COLUMN_TRANSFORMS.find(
                (value) => value === event.target.value,
              ),
            })
          }
          className="bg-surface"
        >
          <option value="">{t('common.states.none')}</option>
          <option value="log10">{t('data.analysisPanel.log')}</option>
          <option value="ln">ln</option>
        </Select>
      </div>
      <div className="flex min-w-32 flex-col gap-1">
        <label
          className="text-label text-fg-muted"
          htmlFor="analysis-x-transform"
        >
          {t('data.analysisPanel.xTransform')}
        </label>
        <Select
          id="analysis-x-transform"
          aria-label={t('data.analysisPanel.ariaPredictorTransform')}
          size="sm"
          value={definition.predictorTransform ?? ''}
          onChange={(event) =>
            onChange({
              predictorTransform: COLUMN_TRANSFORMS.find(
                (value) => value === event.target.value,
              ),
            })
          }
          className="bg-surface"
        >
          <option value="">{t('common.states.none')}</option>
          <option value="log10">{t('data.analysisPanel.log')}</option>
          <option value="ln">ln</option>
        </Select>
      </div>
      <BindingControl
        id="analysis-regression-group"
        label={t('data.analysisPanel.groupFitsOptional')}
        ariaLabel={t('data.analysisPanel.ariaRegressionGroupingColumn')}
        binding={definition.group}
        columns={category}
        emptyLabel={t('data.analysisPanel.oneFit')}
        onChange={(group) => onChange({ group })}
      />
    </>
  )
}

function CurveControls({
  definition,
  numeric,
  category,
  onChange,
}: {
  definition: Extract<AnalysisDefinition, { kind: 'curve' }>
  numeric: Columns
  category: Columns
  onChange: ChangeDefinition
}) {
  return (
    <>
      <BindingControl
        id="curve-dose"
        label={t('data.analysisPanel.curveDose')}
        ariaLabel={t('data.analysisPanel.ariaCurveDose')}
        binding={definition.dose}
        columns={numeric}
        onChange={(dose) => onChange({ dose: dose ?? undefined })}
      />
      <BindingControl
        id="curve-response"
        label={t('data.analysisPanel.curveResponse')}
        ariaLabel={t('data.analysisPanel.ariaCurveResponse')}
        binding={definition.response}
        columns={numeric}
        onChange={(response) => onChange({ response: response ?? undefined })}
      />
      <div className="flex min-w-32 flex-col gap-1">
        <label className="text-label text-fg-muted" htmlFor="curve-model">
          {t('data.analysisPanel.curveModel')}
        </label>
        <Select
          id="curve-model"
          aria-label={t('data.analysisPanel.ariaCurveModel')}
          size="sm"
          value={definition.model ?? '4pl'}
          onChange={(event) =>
            onChange({ model: event.target.value === '5pl' ? '5pl' : '4pl' })
          }
          className="bg-surface"
        >
          <option value="4pl">{t('data.analysisPanel.curve4pl')}</option>
          <option value="5pl">{t('data.analysisPanel.curve5pl')}</option>
        </Select>
      </div>
      <BindingControl
        id="curve-label"
        label={t('data.analysisPanel.curveLabel')}
        ariaLabel={t('data.analysisPanel.ariaCurveLabel')}
        binding={definition.label}
        columns={[...category, ...numeric]}
        emptyLabel={t('common.states.none')}
        onChange={(label) => onChange({ label })}
      />
      <BindingControl
        id="curve-group"
        label={t('data.analysisPanel.curveGroup')}
        ariaLabel={t('data.analysisPanel.ariaCurveGroup')}
        binding={definition.group}
        columns={category}
        emptyLabel={t('data.analysisPanel.oneFit')}
        onChange={(group) => onChange({ group })}
      />
      <p className="basis-full text-xs text-fg-muted">
        {t('data.analysisPanel.curveHint')}
      </p>
    </>
  )
}

export function AnalysisDefinitionControls({
  definition,
  table,
  onChange,
}: {
  definition: AnalysisDefinition
  table: CanonicalDatasetSource
  onChange: ChangeDefinition
}) {
  const numeric = table.columns.filter((column) =>
    ['decimal', 'integer'].includes(column.logicalType),
  )

  const category = table.columns.filter((column) =>
    ['category', 'text', 'boolean'].includes(column.logicalType),
  )

  return (
    <div className="flex flex-wrap items-end gap-3">
      {definition.kind === 'descriptive' ? (
        <>
          <BindingControl
            id="analysis-value"
            label={t('data.analysisPanel.measuredValue')}
            ariaLabel={t('data.analysisPanel.ariaMeasuredValueColumn')}
            binding={definition.value}
            columns={numeric}
            onChange={(value) => onChange({ value: value ?? undefined })}
          />
          <BindingControl
            id="analysis-group"
            label={t('data.analysisPanel.groupOptional')}
            ariaLabel={t('data.analysisPanel.ariaGroupColumn')}
            binding={definition.group}
            columns={category}
            emptyLabel={t('data.analysisPanel.oneGroup')}
            onChange={(group) => onChange({ group })}
          />
        </>
      ) : definition.kind === 'curve' ? (
        <CurveControls
          definition={definition}
          numeric={numeric}
          category={category}
          onChange={onChange}
        />
      ) : definition.kind === 'comparison' ? (
        <ComparisonControls
          definition={definition}
          table={table}
          onChange={onChange}
        />
      ) : definition.kind === 'survival' ? (
        <SurvivalControls
          definition={definition}
          table={table}
          onChange={onChange}
        />
      ) : (
        <RegressionControls
          definition={definition}
          numeric={numeric}
          category={category}
          onChange={onChange}
        />
      )}
    </div>
  )
}
