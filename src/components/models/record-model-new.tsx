import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { Notice } from '#/components/ui/alert'
import { Input } from '#/components/ui/input'
import { Section } from '#/components/ui/layout'
import { PickerSelect } from '#/components/record-picker/entity-picker'
import { projectOption } from '#/components/record-picker/entity-options'
import { ModelFieldInput } from '#/components/scientific/model-field-input'
import { evaluateModelRules } from '#/lib/model-rules'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  buildRecordModelCustomFields,
  modelFieldErrorMessage,
  modelFieldInputErrors,
  recordModelNextIdentifier,
  useModelRules,
  useRecordModelFields,
  useRecordModelProjects,
  useRecordModelRecords,
  useWorkspaceRecordModel,
} from './models-data'
import type { RecordModelRecord } from './models-data'
import { useModelTypes, useTypeFields } from './model-subtype-data'
import { setModelType, typeRoot } from '#/lib/model-subtypes'
import { rich, t } from '#/copy'
import {
  createRegistryEntry,
  findDuplicates,
  isDuplicateError,
  registryKeys,
} from '#/lib/bio-registry'
import {
  DuplicateNotice,
  SequenceReader,
} from '#/components/registry/registry-form'
import type { ReadSequence } from '#/components/registry/registry-form'

/**
 * MDL-04.2 — the "new record" form is generated from the model's active field
 * definitions: types, units, choices, record links and the model's rules shown
 * inline. The same validation kernel (`validateModelFieldValue` →
 * `parseModelFieldInput`) runs here and in `create_model_record`; the server
 * stays authoritative. No per-model form code.
 */
export function RecordModelNew({ modelKey }: { modelKey: string }) {
  const navigate = useNavigate()
  const model = useWorkspaceRecordModel(modelKey)
  const ownFields = useRecordModelFields(modelKey)
  const rulesQuery = useModelRules(modelKey)
  const projectsQuery = useRecordModelProjects()
  const recordsQuery = useRecordModelRecords(modelKey)
  // A subtype's record is a record of the type at the top of its chain, with
  // every field from there down.
  const types = useModelTypes()
  const parentKey = model.data?.parent_key ?? null
  const rootKey = parentKey && types.data ? typeRoot(types.data, modelKey) : ''
  const chainFields = useTypeFields(types.data, rootKey, modelKey, null, {
    enabled: Boolean(parentKey),
  })
  const fieldsQuery = parentKey ? chainFields : ownFields

  const fields = useMemo(
    () =>
      parentKey
        ? (chainFields.data ?? []).flatMap((group) => group.fields)
        : (ownFields.data ?? []),
    [parentKey, chainFields.data, ownFields.data],
  )
  const rootFieldKeys = new Set(
    (chainFields.data ?? [])
      .filter((group) => group.modelKey === rootKey)
      .flatMap((group) => group.fields.map((field) => field.fieldName)),
  )
  const names: Record<string, true> = Object.fromEntries(
    fields.map((field) => [field.fieldName, true as const]),
  )
  const rules = rulesQuery.data ?? []
  const projects = projectsQuery.data ?? []
  const records = recordsQuery.data ?? []

  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState('')
  const [values, setValues] = useState<Record<string, string | boolean>>({})
  const [submitting, setSubmitting] = useState(false)
  const [sequence, setSequence] = useState<ReadSequence | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  // Errors are held back until the person has interacted: a pristine form is
  // not an error state, and the disabled Create button is not the message.
  const [interacted, setInteracted] = useState(false)

  const selectedProject = projectId || projects[0]?.id || ''

  const isRegistry = Boolean(model.data?.is_registry)
  const sequenceField = isRegistry
    ? (model.data?.registry_sequence_field ?? null)
    : null
  // The sequence file fills the sequence field, so it is not typed in too.
  const shownFields = useMemo(
    () =>
      fields.filter(
        (field) =>
          field.fieldName !== sequenceField &&
          !(
            sequenceField &&
            (field.fieldName === 'sequence_length' ||
              field.fieldName === 'shape')
          ),
      ),
    [fields, sequenceField],
  )
  const customFields = useMemo(
    () => buildRecordModelCustomFields(fields, values),
    [fields, values],
  )

  // Ask the database whether this is already registered, once typing settles.
  const [settled, setSettled] = useState({ title: '', custom: '' })
  const customJson = JSON.stringify(customFields)
  useEffect(() => {
    const timer = window.setTimeout(
      () => setSettled({ title, custom: customJson }),
      300,
    )
    return () => window.clearTimeout(timer)
  }, [title, customJson])
  const duplicates = useQuery({
    queryKey: [
      ...registryKeys.all,
      'duplicates',
      modelKey,
      settled.title.trim().toLowerCase(),
      settled.custom,
    ],
    queryFn: () =>
      findDuplicates(notebookDataClient, {
        kind: modelKey,
        title: settled.title,
        customFields: JSON.parse(settled.custom) as Record<string, unknown>,
      }),
    enabled:
      isRegistry && (settled.title.trim() !== '' || settled.custom !== '{}'),
    staleTime: 5_000,
  })
  const matches = isRegistry ? (duplicates.data ?? []) : []

  const fieldErrors = useMemo(
    () => modelFieldInputErrors(fields, values),
    [fields, values],
  )
  const validation = useMemo(
    () => evaluateModelRules(rules, customFields),
    [rules, customFields],
  )
  const titleError = title.trim()
    ? null
    : t('library.models.recordModelNew.nameIsRequired')

  const idPreview = recordModelNextIdentifier(
    model.data?.identifier_prefix ?? '',
    records,
  )

  const canSubmit =
    !submitting &&
    !titleError &&
    validation.blocks.length === 0 &&
    Object.keys(fieldErrors).length === 0 &&
    Boolean(selectedProject) &&
    (matches.length === 0 || acknowledged)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!canSubmit || !model.data) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const created = isRegistry
        ? await createRegistryEntry<RecordModelRecord>(notebookDataClient, {
            projectId: selectedProject,
            kind: modelKey,
            title: title.trim(),
            customFields,
            allowDuplicate: acknowledged,
          })
        : await notebookDataClient.rpc<RecordModelRecord>(
            'create_model_record',
            {
              p_project_id: selectedProject,
              p_kind: parentKey ? rootKey : modelKey,
              p_title: title.trim(),
              p_status: 'draft',
              p_tags: [],
              p_properties: {},
              p_custom_fields: parentKey
                ? Object.fromEntries(
                    Object.entries(customFields).filter(([key]) =>
                      rootFieldKeys.has(key),
                    ),
                  )
                : customFields,
            },
          )
      if (parentKey)
        await setModelType(
          notebookDataClient,
          'record',
          created.id,
          modelKey,
          customFields,
        )
      await navigate({
        to: '/models/$modelId/records/$recordId',
        params: {
          modelId: parentKey ? rootKey : modelKey,
          recordId: created.id,
        },
      })
    } catch (caught) {
      if (isDuplicateError(caught)) {
        void duplicates.refetch()
        setSubmitError(t('registry.duplicate.refused'))
        setSubmitting(false)
        return
      }
      setSubmitError(
        caught instanceof Error
          ? caught.message
          : t('library.models.recordModelNew.couldNotCreateTheRecord'),
      )
      setSubmitting(false)
    }
  }

  if (!model.isLoading && !model.data) {
    return (
      <div className="px-4 py-6 md:px-6">
        <EmptyState
          icon="table"
          title={t('library.models.recordModelNew.modelNotFound')}
          description={t(
            'library.models.recordModelNew.noWorkspaceRecordModelWith',
            { modelKey },
          )}
          action={
            <Button
              variant="primary"
              nativeButton={false}
              render={<Link to="/models" />}
            >
              {t('library.models.recordModelNew.backToModels')}
            </Button>
          }
        />
      </div>
    )
  }

  const loading =
    model.isLoading || fieldsQuery.isLoading || projectsQuery.isLoading

  return (
    <form
      onSubmit={submit}
      className="flex min-w-0 flex-1 flex-col overflow-auto px-4 py-4 md:px-6"
    >
      <Section
        title={t('library.models.recordModelNew.new', {
          name: model.data?.name ?? 'record',
        })}
      >
        {loading ? (
          <p className="text-label text-fg-muted">
            {t('library.models.recordModelNew.loadingFields')}
          </p>
        ) : fields.length === 0 ? (
          <p className="text-label text-fg-muted">
            {t('library.models.recordModelNew.thisModelHasNoActive')}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="text-xs text-fg-muted">
              {t('library.models.recordModelNew.name')}
              <Input
                className="mt-1 h-8 text-xs"
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value)
                  setInteracted(true)
                }}
                aria-label={t('library.models.recordModelNew.name2')}
                required
              />
              {interacted && titleError ? (
                <span role="alert" className="mt-1 block text-danger-text">
                  {titleError}
                </span>
              ) : null}
            </label>

            {matches.length > 0 ? (
              <div className="md:col-span-2">
                <DuplicateNotice
                  modelKey={modelKey}
                  matches={matches}
                  acknowledged={acknowledged}
                  onAcknowledge={setAcknowledged}
                />
              </div>
            ) : null}

            {sequenceField ? (
              <SequenceReader
                value={sequence}
                disabled={submitting}
                onChange={(next) => {
                  setSequence(next)
                  setAcknowledged(false)
                  setValues((current) => {
                    const out = { ...current }
                    if (next) out[sequenceField] = next.fingerprint
                    else delete out[sequenceField]
                    if (next && 'sequence_length' in names)
                      out.sequence_length = String(next.length)
                    if (next && 'shape' in names) out.shape = next.shape
                    return out
                  })
                  if (next && !title.trim()) setTitle(next.name)
                }}
              />
            ) : null}

            {projects.length > 1 ? (
              <label className="text-xs text-fg-muted">
                {t('library.models.recordModelNew.project')}
                <PickerSelect
                  noun="project"
                  className="mt-1 h-8 text-xs"
                  value={selectedProject}
                  onChange={(id) => setProjectId(id)}
                  aria-label={t('library.models.recordModelNew.project2')}
                  options={projects.map((project) => projectOption(project))}
                />
              </label>
            ) : projects.length === 1 ? (
              <div className="text-xs text-fg-muted">
                {rich('library.models.recordModelNew.project3', {
                  title: projects[0].title,
                  p: (text) => (
                    <p className="mt-1 mb-0 text-body text-fg">{text}</p>
                  ),
                })}
              </div>
            ) : (
              <div className="md:col-span-2">
                <Notice
                  tone="warn"
                  title={t('library.models.recordModelNew.aProjectIsRequired')}
                  action={
                    <Button
                      size="sm"
                      nativeButton={false}
                      render={<Link to="/projects" />}
                    >
                      {t('library.models.recordModelNew.projects')}
                    </Button>
                  }
                >
                  {t('library.models.recordModelNew.everyRecordIsFiledUnder')}
                </Notice>
              </div>
            )}

            {shownFields.map((field) => (
              <div key={field.id} className="flex flex-col gap-1">
                <ModelFieldInput
                  definition={field}
                  value={
                    values[field.fieldName] ??
                    (field.logicalType === 'boolean' ? false : '')
                  }
                  onChange={(value) => {
                    setValues((current) => ({
                      ...current,
                      [field.fieldName]: value,
                    }))
                    setInteracted(true)
                  }}
                />
                {interacted && fieldErrors[field.fieldName] ? (
                  <span
                    role="alert"
                    className="text-[0.65rem] text-danger-text"
                  >
                    {modelFieldErrorMessage(fieldErrors[field.fieldName])}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        )}

        {validation.blocks.length || validation.warnings.length ? (
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-label">
            {[...validation.blocks, ...validation.warnings].map((match) => (
              <li
                key={match.ruleId}
                className={
                  match.effect === 'block'
                    ? 'text-danger-text'
                    : 'text-fg-muted'
                }
              >
                {match.effect === 'block'
                  ? t('library.models.recordModelNew.blocked')
                  : t('library.models.recordModelNew.rule')}
                {match.message}
              </li>
            ))}
          </ul>
        ) : null}

        {submitError ? (
          <p role="alert" className="m-0 text-label text-danger-text">
            {submitError}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" disabled={!canSubmit}>
            {submitting
              ? t('library.models.recordModelNew.creating')
              : t('library.models.recordModelNew.create', {
                  name: model.data?.name ?? 'record',
                })}
          </Button>
          <Button
            variant="quiet"
            nativeButton={false}
            render={
              <Link
                to="/models/$modelId/records"
                params={{ modelId: modelKey }}
              />
            }
          >
            {t('common.actions.cancel')}
          </Button>
          <span className="flex-1" />
          {parentKey ? null : (
            <span className="text-label text-fg-muted">
              {rich('library.models.recordModelNew.idOnSave', {
                idPreview,
                span: (text) => <span className="mono">{text}</span>,
              })}
            </span>
          )}
        </div>
      </Section>
    </form>
  )
}
