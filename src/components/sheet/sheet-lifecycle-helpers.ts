import { t } from '#/copy'

/** Local-only sheets use promotion rather than Definition-backed writes. */
export function lifecycleErrorText(message: string): string {
  if (/active Definition-backed Sheet Instance required/i.test(message))
    return t('notebook.canonicalSheetLifecyclePanel.thisSheetIsNot')

  if (/local row identity must be one declared reference/i.test(message))
    return t('notebook.canonicalSheetLifecyclePanel.aDefinitionNeedsOne')

  return message
}

export function configurationDefinitionHref(
  definitionId: string,
  versionId?: string,
  instanceId?: string,
) {
  const search = new URLSearchParams()

  if (versionId) search.set('version', versionId)

  if (instanceId) search.set('returnTo', `/sheets/${instanceId}`)

  return `/sheet-definitions/${encodeURIComponent(definitionId)}${search.size ? `?${search}` : ''}`
}
