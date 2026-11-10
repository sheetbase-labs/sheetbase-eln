import { z } from 'zod'

import type { RevisionChange } from '#/lib/revision-diff'
import { t } from '#/copy'

export const areaLabel = (area: RevisionChange['area']) =>
  t(`projects.diffReview.areas.${area}`)

const textValue = z.string()

const objectValue = z.custom<object>(
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Approved native-object boundary: preserve arrays, nonplain objects, JSON getters/toJSON and native throws without reconstruction.
  (value) => value !== null && typeof value === 'object',
)

/** Present frozen values without replacing native JSON or String semantics. */
export function exactText(value: RevisionChange['before']): string {
  const parsedText = textValue.safeParse(value)

  if (parsedText.success) return parsedText.data

  if (value === null) return 'null'

  if (value === undefined) return t('projects.diffReview.notPresent')

  if (objectValue.safeParse(value).success)
    return JSON.stringify(value, null, 2)

  // oxlint-disable-next-line typescript/no-base-to-string -- Approved native diff display: preserve String coercion of functions, symbols and bigint after the JSON object branch.
  return String(value)
}
