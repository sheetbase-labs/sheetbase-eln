import type { PickerOption } from '#/components/record-picker/entity-picker'
import {
  projectOption,
  recordSearch,
} from '#/components/record-picker/entity-options'
import { parameterInput } from '#/components/templates/templates-data'
import type {
  askedParameters,
  buildTemplateRows,
} from '#/components/templates/templates-data'
import type { CreatedExperiment } from './-new-experiment-create'
import type { ProjectOption } from './-new-experiment-sources'
import { t } from '#/copy'

/** Where the new experiment starts: blank, a protocol's version, or a template. */
export type StartFrom = 'blank' | 'protocol' | 'template'

/** Earlier experiments to copy from: searched on the server, not preloaded. */
export const copyFromSearch = recordSearch(['Experiment'])

/**
 * The refusal the create RPC actually returns, said in a way the author can
 * act on. A row-level-security rejection means the project is view-only for
 * this account (or the workspace role cannot create records there at all), so
 * it names the fix instead of printing the policy name.
 */
export function createErrorMessage(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the create refusal is a caught throw, so it reaches this message untyped; `instanceof` below narrows it to its message.
  error: unknown,
): string {
  const message = error instanceof Error ? error.message : ''

  if (/project is archived/i.test(message)) {
    return t('projects.newExperiment.errors.archived')
  }

  if (/row-level security|permission_denied|permission denied/i.test(message)) {
    return t('projects.newExperiment.errors.permission')
  }

  return message || t('projects.newExperiment.errors.generic')
}

/** A project is archived when either flag says so; the create RPC refuses both. */
export function projectArchived(project: ProjectOption): boolean {
  return Boolean(project.archived_at) || project.status === 'archived'
}

/**
 * A project can hold a new experiment when the account can edit it and the
 * project is not archived. Until the permission read answers we do not know,
 * so every project counts as usable: the create states its own refusal
 * inline, which beats an inert form.
 */
export function projectUsable(
  project: ProjectOption,
  writableProjectIds: ReadonlySet<string>,
  accessKnown: boolean,
): boolean {
  if (!accessKnown) return true

  return writableProjectIds.has(project.id) && !projectArchived(project)
}

/** The project the form creates in: the chosen one when usable, else the first that is. */
export function usableProjectId(
  rows: ProjectOption[],
  canCreateIn: (project: ProjectOption) => boolean,
  chosenProject: ProjectOption | undefined,
): string {
  if (chosenProject && canCreateIn(chosenProject)) return chosenProject.id

  return rows.find((project) => canCreateIn(project))?.id ?? ''
}

/** What the project picker says while the reads settle. */
export function projectPickerPlaceholder(state: {
  loading: boolean
  failed: boolean
  accessPending: boolean
  projectCount: number
}): string | undefined {
  if (state.loading) return t('projects.newExperiment.loadingProjects')

  if (state.failed) return t('projects.newExperiment.listUnavailable')

  if (state.accessPending) return t('projects.newExperiment.checkingAccess')

  if (state.projectCount === 0) return t('projects.newExperiment.noProjects')

  return undefined
}

/** The project picker's hint: said only when some project cannot be chosen. */
export function projectPickerHint(
  rows: ProjectOption[],
  accessKnown: boolean,
  canCreateIn: (project: ProjectOption) => boolean,
): string | undefined {
  const refused = rows.some((project) => !canCreateIn(project))

  return accessKnown && refused
    ? t('projects.newExperiment.projectHint')
    : undefined
}

/** The project picker's options, naming why an unusable project is unusable. */
export function projectPickerOptions(
  rows: ProjectOption[],
  canCreateIn: (project: ProjectOption) => boolean,
): PickerOption[] {
  return rows.map((project) =>
    projectOption(
      project,
      canCreateIn(project)
        ? null
        : projectArchived(project)
          ? t('projects.newExperiment.archived')
          : 'Read-only',
    ),
  )
}

/** The title's error, once the author has tried to submit. */
export function titleErrorOf(
  touched: boolean,
  title: string,
): string | undefined {
  return touched && title.trim().length < 5
    ? t('projects.newExperiment.titleError')
    : undefined
}

/** The project's error, once the author has tried to submit. */
export function projectErrorOf(
  touched: boolean,
  effectiveProjectId: string,
  rows: ProjectOption[],
): string | undefined {
  if (!touched || effectiveProjectId) return undefined

  return rows.length === 0
    ? t('projects.newExperiment.chooseProject')
    : t('projects.newExperiment.chooseEditable')
}

/** The toast title for a created experiment: started, or made as a draft. */
export function createdTitle(result: CreatedExperiment): string {
  return result.started
    ? t('projects.newExperiment.started', {
        identifier: result.record.identifier,
      })
    : t('projects.newExperiment.created', {
        identifier: result.record.identifier,
      })
}

/** What the toast says under that title about the protocol and the start. */
export function createdDescription(result: CreatedExperiment): string {
  if (result.protocolPinError) {
    return t('projects.newExperiment.pinFailed', {
      reason: result.protocolPinError,
    })
  }

  if (result.protocolInNotebook) return t('projects.newExperiment.pinned')

  if (result.started) return t('projects.newExperiment.opensOnNotebook')

  return t('projects.newExperiment.startLater')
}

/** The breadcrumb: under the project once one is usable, else under Experiments. */
export function breadcrumbTrail(effectiveProject: ProjectOption | undefined) {
  if (!effectiveProject) {
    return [
      {
        label: t('projects.newExperiment.experiments'),
        link: { to: '/experiments' as const },
      },
      { label: t('projects.newExperiment.new') },
    ]
  }

  return [
    {
      label: t('projects.newExperiment.projects'),
      link: { to: '/projects' as const },
    },
    {
      label: effectiveProject.title,
      link: {
        to: '/projects/$projectId' as const,
        params: { projectId: effectiveProject.id },
      },
    },
    { label: t('projects.newExperiment.title') },
  ]
}

/** Protocol versions as the picker lists them, named after their protocol. */
export function protocolOptionsOf(
  versions: Array<{ id: string; protocol_record_id: string; version: number }>,
  protocols: Array<{ id: string; identifier: string; title: string }>,
): PickerOption[] {
  return versions.map((version) => {
    const record = protocols.find(
      (candidate) => candidate.id === version.protocol_record_id,
    )

    return {
      id: version.id,
      identifier: record?.identifier,
      label: `${record?.title ?? t('projects.newExperiment.protocol')} · v${version.version}`,
      status: {
        tone: 'ok' as const,
        label: t('projects.newExperiment.label'),
      },
    }
  })
}

/** What the protocol picker says before a version is chosen. */
export function protocolHintOf(
  effectiveProtocolVersionId: string,
  startNow: boolean,
): string {
  return effectiveProtocolVersionId && !startNow
    ? t('projects.newExperiment.protocolDraftHint')
    : t('projects.newExperiment.protocolPinnedHint')
}

/** What the template picker says while its list loads or is empty. */
export function templatePlaceholderOf(
  loading: boolean,
  templateCount: number,
): string {
  if (loading) return t('projects.newExperiment.loadingTemplates')

  if (templateCount === 0) return t('projects.newExperiment.noTemplates')

  return t('projects.newExperiment.pickTemplate')
}

export type TemplateRow = ReturnType<typeof buildTemplateRows>[number]

/** Published templates as the picker lists them. */
export function templateOptionsOf(templates: TemplateRow[]): PickerOption[] {
  return templates.map((row) => ({
    id: row.id,
    label: row.name,
    detail: t('projects.newExperiment.detail', {
      version: row.published?.version ?? '',
    }),
  }))
}

/** One asked template parameter with what the author has typed for it. */
export interface AskedParameterRow {
  id: string
  label: string
  value: string
  error: string | undefined
}

/** The template's asked parameters, with the values and errors the form shows. */
export function askedParameterRowsOf(
  parameters: ReturnType<typeof askedParameters>,
  values: Record<string, string>,
  touched: boolean,
): AskedParameterRow[] {
  return parameters.map((parameter) => {
    const value = values[parameter.id] ?? ''
    const missing = parameterInput(parameter, value) === null

    return {
      id: parameter.id,
      label: parameter.label,
      value,
      error:
        touched && missing ? t('projects.newExperiment.needsValue') : undefined,
    }
  })
}

/**
 * Whether the create button's work may run: every guard the form checks before
 * it calls the create RPC, in the order the author meets them.
 */
export function submissionAllowed({
  accessPending,
  title,
  effectiveProjectId,
  needsAcknowledgement,
  acknowledged,
  addedFieldsValid,
  startFrom,
  templateVersionId,
  missingParameterCount,
}: {
  accessPending: boolean
  title: string
  effectiveProjectId: string
  needsAcknowledgement: boolean
  acknowledged: boolean
  addedFieldsValid: boolean
  startFrom: StartFrom
  templateVersionId: string | null
  missingParameterCount: number
}): boolean {
  if (accessPending || title.trim().length < 5 || !effectiveProjectId)
    return false

  if (needsAcknowledgement && !acknowledged) return false

  if (!addedFieldsValid) return false

  if (
    startFrom === 'template' &&
    (!templateVersionId || missingParameterCount > 0)
  )
    return false

  return true
}

/** The create button's label: creating, then start now or bind as a draft. */
export function createButtonLabelOf(
  creating: boolean,
  startNow: boolean,
): string {
  if (creating) return t('projects.newExperiment.creating')

  return startNow
    ? t('projects.newExperiment.createStart')
    : t('projects.newExperiment.createDraft')
}
