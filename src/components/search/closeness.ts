import { t } from '#/copy'
import type { Tone } from '#/components/ui/status'

/** How close a hit is, in words a scientist would use. */
export function closenessLabel(similarity: number): string {
  if (similarity >= 0.6) return t('projects.searchMeaning.veryClose')

  if (similarity >= 0.45) return t('projects.searchMeaning.close')

  return t('projects.searchMeaning.related')
}

export function closenessTone(similarity: number): Tone {
  if (similarity >= 0.6) return 'ok'

  if (similarity >= 0.45) return 'progress'

  return 'none'
}
