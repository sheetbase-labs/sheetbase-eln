import type { AddSampleDataResult } from '#/lib/sample-data'
import { t } from '#/copy'

/** What to tell the admin when the sample data could not be added. */
export function describeSampleDataFailure(
  result: Extract<AddSampleDataResult, { ok: false }>,
  projectKey = 'virus-stability',
): string {
  return result.reason === 'project_key_in_use'
    ? t('settings.sampleData.keyInUse', { key: projectKey })
    : t('settings.sampleData.elsewhere')
}
