/**
 * What a project's Sheets tab says about a sheet and how it caches the list,
 * apart from the tab that draws it.
 */
import { t } from '#/copy'
import type { SheetInstance } from '#/lib/sheet-instance-data'

export const projectSheetsKey = (projectId: string, archived: boolean) =>
  [
    'ui-port',
    'project-sheets',
    projectId,
    archived ? 'archived' : 'active',
  ] as const

/** What a sheet was made from, in the words a person uses. */
export function sheetOrigin(
  sheet: Pick<
    SheetInstance,
    'sourceDefinitionVersionId' | 'duplicatedFromInstanceId'
  >,
) {
  if (sheet.sourceDefinitionVersionId)
    return t('projects.projectSheets.origin.definition')

  if (sheet.duplicatedFromInstanceId)
    return t('projects.projectSheets.origin.copy')

  return t('projects.projectSheets.origin.working')
}
