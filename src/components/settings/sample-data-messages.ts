import type { AddSampleDataResult } from '#/lib/sample-data'
import { t } from '#/copy'

/** What to tell the person when the demo workspace could not be created. */
export function describeSampleDataFailure(
  _result: Extract<AddSampleDataResult, { ok: false }>,
): string {
  return t('settings.sampleData.elsewhere')
}
