import { t } from '#/copy'

type Loose = (key: string, values?: Record<string, string | number>) => string

/**
 * The words of Simple pipelines, `features.pipelineSimple.<prefix>.<key>`. The
 * key is built at the call site (an operator, a mode, a channel), which the
 * typed `t()` cannot check, so this is the one place it is read loosely.
 */
export function words(prefix = ''): Loose {
  // SAFETY: `t` takes typed keys; every key built here is one of this feature's own.
  const loose = t as Loose

  return (key, values) =>
    loose(`features.pipelineSimple.${prefix ? `${prefix}.` : ''}${key}`, values)
}
