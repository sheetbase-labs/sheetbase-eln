import { DataClientError } from '#/lib/data-client'
import { t } from '#/copy'

/** The key contract the create RPC enforces (`SB071`). */
const MODEL_KEY_PATTERN = /^[a-z][a-z0-9_]{0,59}$/
export const MODEL_NAME_MAX = 200
export const MODEL_DESCRIPTION_MAX = 2000

export interface ModelCreateInput {
  kind: 'record' | 'dataset'
  identifierPrefix?: string
  key: string
  name: string
  description: string | null
}

interface ModelCreateErrors {
  key?: string
  name?: string
  description?: string
}

/** Check metadata locally; the create RPC remains authoritative. */
export function modelCreateErrors(input: {
  key: string
  name: string
  description: string
}): ModelCreateErrors {
  const key = input.key.trim()
  const name = input.name.trim()
  const description = input.description.trim()
  const errors: ModelCreateErrors = {}

  if (!key) errors.key = t('library.models.modelCreateDialog.keyIsRequired')
  else if (!MODEL_KEY_PATTERN.test(key))
    errors.key = t('library.models.modelCreateDialog.useLowerCaseLettersDigits')

  if (!name) errors.name = t('library.models.modelCreateDialog.nameIsRequired')
  else if (name.length > MODEL_NAME_MAX)
    errors.name = t('library.models.modelCreateDialog.nameMustBeCharactersOr', {
      modelNameMax: MODEL_NAME_MAX,
    })

  if (description.length > MODEL_DESCRIPTION_MAX)
    errors.description = t(
      'library.models.modelCreateDialog.descriptionMustBeCharactersOr',
      { modelDescriptionMax: MODEL_DESCRIPTION_MAX },
    )

  return errors
}

/** Map the RPC's refusal to a short, true reason. */
export function describeModelCreateError(
  error: Error | null | undefined,
): string | null {
  if (error == null) return null

  if (error instanceof DataClientError) {
    if (error.code === '42501' || /capability/i.test(error.message))
      return t('library.models.modelCreateDialog.youDontHavePermissionTo')

    if (error.code === 'SB082')
      return t('library.models.modelCreateDialog.thatRecordTypeKeyOr')

    if (error.code === '23505' || /duplicate key/i.test(error.message))
      return t('library.models.modelCreateDialog.aModelWithThatKey')

    return error.message
  }

  return error instanceof Error
    ? error.message
    : t('library.models.modelCreateDialog.couldNotCreateTheModel')
}
