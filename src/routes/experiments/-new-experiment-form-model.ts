import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'

import { toast } from '#/components/ui/sonner'
import { useAddedFieldDraft } from '#/components/models/added-fields'
import type { PickerOption } from '#/components/record-picker/entity-picker'
import type { CreateContextSearch } from '#/lib/create-context-search'
import { runCreateExperiment } from './-new-experiment-create'
import { useNewExperimentSources } from './-new-experiment-sources'
import { projectChoice, startFromChoice } from './-new-experiment-choice-data'
import {
  breadcrumbTrail,
  createdDescription,
  createdTitle,
  createButtonLabelOf,
  createErrorMessage,
  submissionAllowed,
  titleErrorOf,
} from './-new-experiment-form-data'
import type { StartFrom } from './-new-experiment-form-data'

/** The new-experiment page's search: what the linking page handed over. */
export type NewExperimentSearch = CreateContextSearch & {
  protocol?: string
  template?: string
  series?: string
}

/**
 * The new-experiment form's model: the author's answers, the reads behind the
 * pickers, the project and start-from choices that follow from them, and the
 * create call itself.
 */
export function useNewExperimentForm(search: NewExperimentSearch) {
  const navigate = useNavigate()

  const [startFrom, setStartFrom] = useState<StartFrom>(
    search.template ? 'template' : search.protocol ? 'protocol' : 'blank',
  )

  const sources = useNewExperimentSources({
    sampleId: search.sample,
    seriesId: search.series,
    templateWanted: startFrom === 'template',
  })

  const { projects, assignments } = sources
  const rows = projects.data ?? []

  const [projectId, setProjectId] = useState(search.project ?? '')
  const [title, setTitle] = useState('')
  // null until the author chooses: until then the project's default reviewer
  // stands in, so the reviewer is chosen once and carried to Submit.
  const [reviewerId, setReviewerId] = useState<string | null>(null)
  const [plannedEnd, setPlannedEnd] = useState('')

  const [protocolVersionId, setProtocolVersionId] = useState('')
  const [templateId, setTemplateId] = useState(search.template ?? '')

  const [templateValues, setTemplateValues] = useState<Record<string, string>>(
    {},
  )

  const [startNow, setStartNow] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [copyFromId, setCopyFromId] = useState('')

  const [copyFromOption, setCopyFromOption] = useState<PickerOption | null>(
    null,
  )

  const [touched, setTouched] = useState(false)

  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID(),
  )

  const { members, protocols, protocolVersions, templates, sample, series } =
    sources

  // A protocol handed over by the page that linked here (`?protocol=<record>`)
  // selects its newest effective version once the versions load.
  const handedProtocolVersion = search.protocol
    ? (protocolVersions.data ?? []).find(
        (v) => v.protocol_record_id === search.protocol,
      )
    : undefined

  // The account's write access to each project, read once per assignment page.
  const writableProjectIds = useMemo(
    () =>
      new Set(
        (assignments.data ?? [])
          .filter((assignment) => assignment.can_edit)
          .map((assignment) => assignment.project_id),
      ),
    [assignments.data],
  )

  const accessPending = assignments.isLoading
  const accessKnown = assignments.isSuccess

  const project = projectChoice({
    rows,
    writableProjectIds,
    accessPending,
    accessKnown,
    projectsLoading: projects.isLoading,
    projectsFailed: projects.isError,
    projectId,
    handedProjectId: search.project,
    touched,
  })

  const start = startFromChoice({
    startFrom,
    protocolVersionId,
    handedProtocolVersion,
    protocolVersions: protocolVersions.data ?? [],
    protocols: protocols.data ?? [],
    templates: templates.data ?? [],
    templatesLoading: templates.isLoading,
    templateId,
    startNow,
    templateValues,
    touched,
  })

  const effectiveReviewerId =
    reviewerId ?? project.effectiveProject?.default_reviewer_user_id ?? ''

  const titleError = titleErrorOf(touched, title)

  const addedFields = useAddedFieldDraft('experiment')

  // The create answers by navigating to the new notebook, whose own reads are
  // made fresh; this screen holds no list of experiments to invalidate.
  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation
  const create = useMutation({
    mutationFn: () =>
      runCreateExperiment({
        projectId: project.effectiveProjectId,
        title: title.trim(),
        reviewerUserId: effectiveReviewerId,
        plannedEnd,
        startFrom,
        templateVersionRow: start.templateVersion,
        parameters: start.askedTemplateParameters,
        parameterValues: templateValues,
        acknowledgeProtocol: start.needsAcknowledgement,
        protocolVersionId: start.effectiveProtocolVersionId,
        protocolRecordId: start.protocolId,
        copyFromRecordId: copyFromId,
        sampleRecordId: sample.data?.id,
        seriesId: series.data?.id,
        startNow,
        idempotencyKey,
        addedFieldsTypeKey: addedFields.typeKey,
        addedFieldsPayload: () => addedFields.payload(),
      }),
    onSuccess: (result) => {
      if (result.seriesRefusal) toast.error(result.seriesRefusal)
      toast(createdTitle(result), { description: createdDescription(result) })
      void navigate({
        to: '/experiments/$expId/notebook',
        params: { expId: result.record.id },
      })
    },
    onError: (error) => {
      // A corrected form must not be answered with the earlier refusal.
      setIdempotencyKey(crypto.randomUUID())
      toast.error(createErrorMessage(error))
    },
  })

  const attemptCreate = () => {
    setTouched(true)

    const allowed = submissionAllowed({
      accessPending,
      title,
      effectiveProjectId: project.effectiveProjectId,
      needsAcknowledgement: start.needsAcknowledgement,
      acknowledged,
      addedFieldsValid: addedFields.valid,
      startFrom,
      templateVersionId: start.templateVersion?.id ?? null,
      missingParameterCount: start.missingTemplateParameters.length,
    })

    if (!allowed) return

    create.mutate()
  }

  return {
    search,
    sources,
    rows,
    accessPending,
    accessKnown,
    project,
    start,
    startFrom,
    setStartFrom,
    setProjectId,
    title,
    setTitle,
    titleError,
    reviewerId,
    setReviewerId,
    effectiveReviewerId,
    plannedEnd,
    setPlannedEnd,
    protocolVersionId,
    setProtocolVersionId,
    templateId,
    setTemplateId,
    setTemplateValues,
    startNow,
    setStartNow,
    acknowledged,
    setAcknowledged,
    copyFromId,
    setCopyFromId,
    copyFromOption,
    setCopyFromOption,
    touched,
    addedFields,
    members,
    create,
    attemptCreate,
    createButtonLabel: createButtonLabelOf(create.isPending, startNow),
    trail: breadcrumbTrail(project.effectiveProject),
    /** Reset the protocol's acknowledgement when a different version is picked. */
    chooseProtocol: (id: string) => {
      setProtocolVersionId(id)
      setAcknowledged(false)
    },
    /** A different template starts its answers and idempotency key afresh. */
    chooseTemplate: (id: string) => {
      setTemplateId(id)
      setTemplateValues({})
      setIdempotencyKey(crypto.randomUUID())
    },
    setParameter: (id: string, value: string) =>
      setTemplateValues((current) => ({ ...current, [id]: value })),
  }
}

export type NewExperimentFormModel = ReturnType<typeof useNewExperimentForm>
