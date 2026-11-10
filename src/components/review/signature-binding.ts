import { t } from '#/copy'

function formatVersionList(versions: number[]): string {
  const ordered = [...versions].sort((a, b) => a - b)

  if (ordered.length <= 1) return String(ordered[0] ?? '')

  return t('projects.signatures.listAnd', {
    list: ordered.slice(0, -1).join(', '),
    last: ordered[ordered.length - 1],
  })
}

/** Name only the frozen revision versions that are actually known. */
export function signatureBindingNote(versions: number[]): string {
  if (versions.length === 0) return t('projects.signatures.bindingNone')

  return versions.length === 1
    ? t('projects.signatures.bindingOne', {
        versions: formatVersionList(versions),
      })
    : t('projects.signatures.bindingMany', {
        versions: formatVersionList(versions),
      })
}
