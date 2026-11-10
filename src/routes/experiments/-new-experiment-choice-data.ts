import type { PickerOption } from '#/components/record-picker/entity-picker'
import {
  askedParameters,
  parameterInput,
} from '#/components/templates/templates-data'
import type { NotebookTemplateVersion } from '#/lib/notebook-template-data'
import type { Parameter } from '#/lib/parameter'
import { t } from '#/copy'

import type {
  AskedParameterRow,
  StartFrom,
  TemplateRow,
} from './-new-experiment-form-data'
import {
  askedParameterRowsOf,
  projectErrorOf,
  projectPickerHint,
  projectPickerOptions,
  projectPickerPlaceholder,
  projectUsable,
  protocolHintOf,
  protocolOptionsOf,
  templateOptionsOf,
  templatePlaceholderOf,
  usableProjectId,
} from './-new-experiment-form-data'
import type { ProjectOption } from './-new-experiment-sources'

/** The project the form will create in, and what its picker says about it. */
export interface ProjectChoice {
  canCreateIn: (project: ProjectOption) => boolean
  effectiveProjectId: string
  effectiveProject: ProjectOption | undefined
  /** A hand-off project that cannot take the experiment was replaced. */
  projectReplaced: boolean
  projectError: string | undefined
  projectPlaceholder: string | undefined
  projectHint: string | undefined
  projectOptions: PickerOption[]
}

/**
 * The project picker's model. Two independent reasons a project cannot take a
 * new experiment: the account cannot edit it, or the project is archived
 * (`archive_project` refuses every write under it — `internal.project_is_archived`).
 * Both are shown but neither is ever the default.
 */
export function projectChoice({
  rows,
  writableProjectIds,
  accessPending,
  accessKnown,
  projectsLoading,
  projectsFailed,
  projectId,
  handedProjectId,
  touched,
}: {
  rows: ProjectOption[]
  writableProjectIds: ReadonlySet<string>
  accessPending: boolean
  accessKnown: boolean
  projectsLoading: boolean
  projectsFailed: boolean
  projectId: string
  handedProjectId: string | undefined
  touched: boolean
}): ProjectChoice {
  const canCreateIn = (project: ProjectOption) =>
    projectUsable(project, writableProjectIds, accessKnown)

  const chosenProject = rows.find((project) => project.id === projectId)
  const effectiveProjectId = usableProjectId(rows, canCreateIn, chosenProject)
  const effectiveProject = rows.find((p) => p.id === effectiveProjectId)

  // A hand-off project that cannot take the experiment is replaced by the first
  // one that can; say so rather than creating it somewhere unannounced.
  const handedProject = handedProjectId
    ? rows.find((project) => project.id === handedProjectId)
    : undefined

  const projectReplaced =
    handedProject !== undefined &&
    !canCreateIn(handedProject) &&
    effectiveProject !== undefined &&
    effectiveProject.id !== handedProject.id

  return {
    canCreateIn,
    effectiveProjectId,
    effectiveProject,
    projectReplaced,
    projectError: projectErrorOf(touched, effectiveProjectId, rows),
    projectPlaceholder: projectPickerPlaceholder({
      loading: projectsLoading,
      failed: projectsFailed,
      accessPending,
      projectCount: rows.length,
    }),
    projectHint: projectPickerHint(rows, accessKnown, canCreateIn),
    projectOptions: projectPickerOptions(rows, canCreateIn),
  }
}

/** Where the experiment starts from, and what its pickers say. */
export interface StartFromChoice {
  effectiveProtocolVersionId: string
  protocolId: string
  chosenTemplate: TemplateRow | undefined
  templateVersion: NotebookTemplateVersion | null
  askedTemplateParameters: Parameter[]
  missingTemplateParameters: Parameter[]
  protocolOptions: PickerOption[]
  protocolHint: string
  templatePlaceholder: string
  templateOptions: PickerOption[]
  parameterRows: AskedParameterRow[]
  templateError: string | undefined
  needsAcknowledgement: boolean
}

/**
 * The start-from options' model: the protocol version a handed-over link
 * selects, the template's asked parameters, and the picker copy that follows.
 */
export function startFromChoice({
  startFrom,
  protocolVersionId,
  handedProtocolVersion,
  protocolVersions,
  protocols,
  templates,
  templatesLoading,
  templateId,
  startNow,
  templateValues,
  touched,
}: {
  startFrom: StartFrom
  protocolVersionId: string
  handedProtocolVersion: { id: string } | undefined
  protocolVersions: Array<{
    id: string
    protocol_record_id: string
    version: number
  }>
  protocols: Array<{ id: string; identifier: string; title: string }>
  templates: TemplateRow[]
  templatesLoading: boolean
  templateId: string
  startNow: boolean
  templateValues: Record<string, string>
  touched: boolean
}): StartFromChoice {
  const effectiveProtocolVersionId =
    protocolVersionId || handedProtocolVersion?.id || ''

  const chosenProtocolVersion = protocolVersions.find(
    (v) => v.id === effectiveProtocolVersionId,
  )

  const protocolId =
    startFrom === 'protocol'
      ? (chosenProtocolVersion?.protocol_record_id ?? '')
      : ''

  const chosenTemplate =
    startFrom === 'template'
      ? templates.find((row) => row.id === templateId)
      : undefined

  const templateVersion = chosenTemplate?.published ?? null

  const askedTemplateParameters = templateVersion
    ? askedParameters(templateVersion)
    : []

  const missingTemplateParameters = askedTemplateParameters.filter(
    (p) => parameterInput(p, templateValues[p.id] ?? '') === null,
  )

  return {
    effectiveProtocolVersionId,
    protocolId,
    chosenTemplate,
    templateVersion,
    askedTemplateParameters,
    missingTemplateParameters,
    protocolOptions: protocolOptionsOf(protocolVersions, protocols),
    protocolHint: protocolHintOf(effectiveProtocolVersionId, startNow),
    templatePlaceholder: templatePlaceholderOf(
      templatesLoading,
      templates.length,
    ),
    templateOptions: templateOptionsOf(templates),
    parameterRows: askedParameterRowsOf(
      askedTemplateParameters,
      templateValues,
      touched,
    ),
    templateError:
      touched && !templateVersion
        ? t('projects.newExperiment.chooseTemplate')
        : undefined,
    // Starting from a protocol pins its version, and the server only starts an
    // experiment whose version the operator has acknowledged: ask for that
    // here, before anything is created, instead of leaving a draft behind a
    // refusal.
    needsAcknowledgement:
      startNow &&
      startFrom === 'protocol' &&
      Boolean(effectiveProtocolVersionId),
  }
}
