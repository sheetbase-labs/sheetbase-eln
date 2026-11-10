/**
 * Creating the experiment the form asks for: the wizard's decisions, carried
 * out as the ordinary RPCs so permissions, versions and the audit trail are
 * the page's own. Separate from the screen so the sequence is readable on its
 * own and the route holds no branching business logic.
 */
import { addSeriesMember } from '#/lib/experiment-series'
import { t } from '#/copy'
import { acknowledgeProtocolVersion } from '#/lib/controlled-protocols'
import {
  applyExperimentSetup,
  createBlankExperiment,
  insertPinnedProtocol,
} from '#/lib/notebook-create'
import { notebookDataClient } from '#/lib/notebook-data'
import { instantiateNotebookTemplateVersion } from '#/lib/notebook-template-data'
import type { NotebookTemplateParameterInput } from '#/lib/notebook-template-data'
import { saveNewObjectFields } from '#/lib/model-subtypes'
import { requireBuiltInModel } from '#/lib/built-in-models'
import { parameterInput } from '#/components/templates/templates-data'
import type { askedParameters } from '#/components/templates/templates-data'

const EXPERIMENT_MODEL = requireBuiltInModel('experiment')

/** Where the new experiment starts. */
export type StartFrom = 'blank' | 'protocol' | 'template'

/** What the form has decided when the author presses Create. */
export interface NewExperimentCreate {
  projectId: string
  title: string
  reviewerUserId: string
  plannedEnd: string
  startFrom: StartFrom
  /** The pinned template version to instantiate, when starting from a template. */
  templateVersionRow: { id: string } | null
  parameters: ReturnType<typeof askedParameters>
  parameterValues: Record<string, string>
  acknowledgeProtocol: boolean
  protocolVersionId: string
  protocolRecordId: string
  copyFromRecordId: string
  sampleRecordId: string | undefined
  seriesId: string | undefined
  startNow: boolean
  idempotencyKey: string
  addedFieldsTypeKey: Parameters<typeof saveNewObjectFields>[3]
  addedFieldsPayload: () => Parameters<typeof saveNewObjectFields>[4]
}

/** What the create left behind, for the toast and the redirect. */
export interface CreatedExperiment {
  record: { id: string; identifier: string }
  started: boolean
  protocolInNotebook: boolean
  protocolPinError: string | undefined
  seriesRefusal: string | undefined
}

export async function runCreateExperiment(
  input: NewExperimentCreate,
): Promise<CreatedExperiment> {
  const templateVersionRow =
    input.startFrom === 'template' ? input.templateVersionRow : null

  const series = input.seriesId === undefined ? null : { id: input.seriesId }

  if (input.acknowledgeProtocol) {
    await acknowledgeProtocolVersion(
      notebookDataClient,
      input.protocolVersionId,
    )
  }

  let record: { id: string; identifier: string }

  if (input.startFrom === 'template') {
    if (!templateVersionRow)
      throw new Error(t('projects.newExperiment.chooseTemplate'))

    const instantiated = await instantiateNotebookTemplateVersion(
      {
        versionId: templateVersionRow.id,
        targetProjectId: input.projectId,
        title: input.title,
        parameterInputs: input.parameters.flatMap((parameter) => {
          const value: NotebookTemplateParameterInput | null = parameterInput(
            parameter,
            input.parameterValues[parameter.id] ?? '',
          )

          return value ? [value] : []
        }),
        idempotencyKey: input.idempotencyKey,
      },
      notebookDataClient,
    )

    record = instantiated.record
  } else {
    record = await createBlankExperiment(notebookDataClient, {
      projectId: input.projectId,
      title: input.title,
    })
  }

  if (input.reviewerUserId || input.plannedEnd) {
    await notebookDataClient.rpc('set_experiment_fields', {
      p_record_id: record.id,
      p_reviewer_user_id: input.reviewerUserId || null,
      p_planned_end: input.plannedEnd || null,
    })
  }

  // The workspace's own Experiment fields go on before anything else
  // reads the record's version.
  await saveNewObjectFields(
    notebookDataClient,
    EXPERIMENT_MODEL,
    record.id,
    input.addedFieldsTypeKey,
    input.addedFieldsPayload(),
  )
  await applyExperimentSetup(notebookDataClient, record.id, {
    protocolRecordId: input.protocolRecordId || undefined,
    copyFromRecordId: input.copyFromRecordId || undefined,
    sampleRecordId: input.sampleRecordId,
  })
  // The protocol goes into the notebook as a pinned block with its steps,
  // so the notebook and the chosen protocol cannot disagree.
  let protocolInNotebook = false
  let protocolPinError: string | undefined

  if (input.protocolRecordId) {
    try {
      await insertPinnedProtocol(
        notebookDataClient,
        record.id,
        input.protocolRecordId,
      )
      protocolInNotebook = true
    } catch (error) {
      protocolPinError =
        error instanceof Error
          ? error.message
          : t('projects.newExperiment.pinRefused')
    }
  }

  // The new experiment joins the series it was made from. The experiment
  // exists either way, so a refusal is said afterwards, not thrown.
  let seriesRefusal: string | undefined

  if (series) {
    try {
      await addSeriesMember(notebookDataClient, {
        seriesId: series.id,
        memberId: record.id,
      })
    } catch (error) {
      seriesRefusal =
        error instanceof Error ? error.message : t('projects.series.tab.failed')
    }
  }

  if (input.startNow) {
    // Starting is a server decision: PROJ-03 and LAB-07 authority (effective
    // version, exact-version acknowledgement) are enforced by the RPC.
    // Only the checkbox starts the experiment; choosing a protocol version
    // pins the version on start, it does not start anything by itself.
    const current = await notebookDataClient.list<{
      metadata_version: number
    }>('records', `?id=eq.${record.id}&select=metadata_version&limit=1`)

    await notebookDataClient.rpc('start_experiment', {
      p_record_id: record.id,
      p_expected_metadata_version: current.at(0)?.metadata_version ?? 1,
      p_protocol_version_id: input.protocolVersionId || null,
      p_reason: t('projects.newExperiment.startReason'),
    })
  }

  return {
    record,
    started: input.startNow,
    protocolInNotebook,
    protocolPinError,
    seriesRefusal,
  }
}
