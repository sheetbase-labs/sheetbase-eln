import { t } from '#/copy'
import { Notice } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import { Field, Input } from '#/components/v3/ui/input'
import { Select } from '#/components/v3/ui/select'
import {
  checkOutputFit,
  columnForField,
  setFieldColumn,
} from '#/lib/pipelines/authoring'
import {
  usePipelineOutputTargets,
  useSchemaVersionFields,
} from '#/components/v3/pipelines/pipelines-data'

export type OutputMode = 'create' | 'append' | 'none'

export interface OutputDraft {
  mode: OutputMode
  datasetName: string
  schemaVersionId: string
  datasetId: string
  datasetLabel: string
  fieldMapping: Record<string, string> | null
}

const MODE_HELP: Record<OutputMode, string> = {
  none: t('data.outputEditor.resultShownRunPage'),
  create: t('data.outputEditor.datasetCreatedFirstTime'),
  append: t('data.outputEditor.everyRunAddsResult'),
}

/**
 * Where a pipeline's result goes. A scientist picks a mode in plain words, then
 * the dataset (or the schema a new one is built from), and sees the columns the
 * result must produce. A result column that is named differently from the
 * schema field it feeds is matched here, with the columns of the last run
 * offered as suggestions, instead of in configuration JSON.
 */
export function OutputEditor({
  value,
  onChange,
  resultColumns,
  fieldErrors,
}: {
  value: OutputDraft
  onChange: (patch: Partial<OutputDraft>) => void
  /** Column names of the newest successful run, to suggest and to check against. */
  resultColumns: string[]
  /** Contract errors for `output.*`, keyed by the part after `output.`. */
  fieldErrors: Record<string, string>
}) {
  const targets = usePipelineOutputTargets()
  const dataset = (targets.data?.datasets ?? []).find(
    (d) => d.id === value.datasetId,
  )
  const fieldsSchemaVersion =
    value.mode === 'create'
      ? value.schemaVersionId
      : value.mode === 'append'
        ? (dataset?.schemaVersionId ?? '')
        : ''
  const fields = useSchemaVersionFields(fieldsSchemaVersion)
  const fieldList = fields.data ?? []
  const fit = checkOutputFit(fieldList, value.fieldMapping, resultColumns)

  return (
    <div className="flex flex-col gap-4">
      <Field
        label={t('data.outputEditor.whatShouldRunKeep')}
        hint={MODE_HELP[value.mode]}
      >
        <Select
          aria-label={t('data.outputEditor.ariaOutputMode')}
          value={value.mode}
          onChange={(event) =>
            onChange({ mode: event.target.value as OutputMode })
          }
        >
          <option value="none">
            {t('data.outputEditor.justShowResultSave')}
          </option>
          <option value="create">
            {t('data.outputEditor.saveNewDataset')}
          </option>
          <option value="append">
            {t('data.outputEditor.addExistingDataset')}
          </option>
        </Select>
      </Field>

      {value.mode === 'create' ? (
        <>
          <Field
            label={t('data.outputEditor.datasetName')}
            error={fieldErrors.datasetName}
            hint={t('data.outputEditor.shownDatasetsListChanging')}
          >
            <Input
              aria-label={t('data.outputEditor.datasetName')}
              value={value.datasetName}
              onChange={(e) => onChange({ datasetName: e.target.value })}
            />
          </Field>
          <Field
            label={t('data.outputEditor.datasetSchemaVersion')}
            error={fieldErrors.schemaVersionId}
            hint={t('data.outputEditor.columnsDatasetHasResult')}
          >
            <Select
              aria-label={t('data.outputEditor.datasetSchemaVersion')}
              value={value.schemaVersionId}
              onChange={(e) =>
                onChange({
                  schemaVersionId: e.target.value,
                  fieldMapping: null,
                })
              }
            >
              <option value="">
                {t('data.outputEditor.chooseSchemaVersion')}
              </option>
              {(targets.data?.schemaVersions ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Field>
          {!targets.isLoading &&
          !targets.isError &&
          (targets.data?.schemaVersions.length ?? 0) === 0 ? (
            <Notice tone="warn">
              {t('data.outputEditor.workspaceHasActiveDataset')}
            </Notice>
          ) : null}
        </>
      ) : null}

      {value.mode === 'append' ? (
        <Field
          label={t('data.outputEditor.dataset')}
          error={fieldErrors.datasetId}
          hint={t('data.outputEditor.eachRunAddsDataset')}
        >
          <Select
            aria-label={t('data.outputEditor.dataset')}
            value={value.datasetId}
            onChange={(e) =>
              onChange({ datasetId: e.target.value, fieldMapping: null })
            }
          >
            <option value="">{t('data.outputEditor.chooseDataset')}</option>
            {(targets.data?.datasets ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.displayId ? `${d.displayId} · ${d.name}` : d.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      {value.mode !== 'none' ? (
        <Field
          label={t('data.outputEditor.datasetVersionLabel')}
          error={fieldErrors.datasetLabel}
          hint={t('data.outputEditor.namesEachVersionRun')}
        >
          <Input
            aria-label={t('data.outputEditor.datasetVersionLabel')}
            value={value.datasetLabel}
            onChange={(e) => onChange({ datasetLabel: e.target.value })}
          />
        </Field>
      ) : null}

      {value.mode !== 'none' && fieldsSchemaVersion ? (
        <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
          <legend className="mb-1 p-0 text-label font-medium text-fg">
            {t('data.outputEditor.columnsResultMustProduce')}
          </legend>
          {fields.isLoading ? (
            <p className="m-0 text-label text-fg-muted">
              {t('data.outputEditor.loadingColumns')}
            </p>
          ) : fieldList.length === 0 ? (
            <p className="m-0 text-label text-fg-muted">
              {t('data.outputEditor.schemaHasActiveFields')}
            </p>
          ) : (
            <>
              <p className="m-0 text-label text-fg-muted">
                {t('data.outputEditor.nameEachResultColumn')}
              </p>
              <datalist id="pipeline-result-columns">
                {resultColumns.map((column) => (
                  <option key={column} value={column} />
                ))}
              </datalist>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {fieldList.map((field) => (
                  <li
                    key={field.key}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <span className="w-[200px] min-w-0">
                      <span className="mono text-xs">{field.key}</span>
                      {field.required ? (
                        <span aria-hidden="true"> *</span>
                      ) : null}
                      <span className="block text-caption text-fg-muted">
                        {field.label} · {field.type}
                      </span>
                    </span>
                    <span aria-hidden="true" className="text-fg-muted">
                      ←
                    </span>
                    <Input
                      className="mono h-8 w-[200px] text-xs"
                      list="pipeline-result-columns"
                      aria-label={t('data.outputEditor.ariaResultColumn', {
                        key: field.key,
                      })}
                      placeholder={field.key}
                      value={columnForField(value.fieldMapping, field.key)}
                      onChange={(e) =>
                        onChange({
                          fieldMapping: setFieldColumn(
                            value.fieldMapping,
                            field.key,
                            e.target.value,
                          ),
                        })
                      }
                    />
                  </li>
                ))}
              </ul>
              {resultColumns.length ? (
                fit.missing.length || fit.unmatched.length ? (
                  <Notice
                    tone="warn"
                    title={t('data.outputEditor.lastRunSColumns')}
                  >
                    {fit.missing.length
                      ? t('data.outputEditor.columnFeeds', {
                          join: fit.missing.join(', '),
                        })
                      : ''}
                    {fit.unmatched.length
                      ? t('data.outputEditor.noField', {
                          join: fit.unmatched.join(', '),
                          value:
                            fit.unmatched.length === 1 ? 'matches' : 'match',
                        })
                      : ''}
                  </Notice>
                ) : (
                  <p className="m-0 text-label text-fg-muted">
                    {t('data.outputEditor.columnsLastRunFit', {
                      join: resultColumns.join(', '),
                    })}
                  </p>
                )
              ) : (
                <p className="m-0 text-label text-fg-muted">
                  {t('data.outputEditor.runPipelineOnceResult')}
                </p>
              )}
              {value.fieldMapping ? (
                <div>
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => onChange({ fieldMapping: null })}
                  >
                    {t('data.outputEditor.clearColumnMatching')}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </fieldset>
      ) : null}

      {value.mode !== 'none' && targets.isError ? (
        <Notice tone="bad" title={t('data.outputEditor.couldnTLoadDatasets')}>
          {t('data.outputEditor.choicesAboveComeFrom')}{' '}
          <Button size="sm" onClick={() => void targets.refetch()}>
            {t('common.actions.tryAgain')}
          </Button>
        </Notice>
      ) : null}
    </div>
  )
}
