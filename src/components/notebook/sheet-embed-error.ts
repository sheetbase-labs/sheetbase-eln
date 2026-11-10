import { ZodError } from 'zod'
import { t } from '#/copy'
import { DataClientError } from '#/lib/data-client'

/** Shared refusal wording for the live editor and read-only sheet embed. */
export function sheetInstanceEmbedErrorMessage(
  error: Error | null | undefined,
  missing: boolean,
): string {
  if (
    error instanceof DataClientError &&
    (error.status === 401 || error.status === 403)
  ) {
    return t('notebook.notebookSheetBlock.youDoNotHave')
  }

  if (
    error instanceof ZodError ||
    (error instanceof Error && error.name === 'ZodError')
  ) {
    return t('notebook.notebookSheetBlock.thisSheetCouldNot')
  }

  if (
    (error instanceof DataClientError && error.status === 404) ||
    (!error && missing)
  ) {
    return t('notebook.notebookSheetBlock.thisSheetInstanceCould')
  }

  return t('notebook.notebookSheetBlock.thisSheetCouldNot2')
}
