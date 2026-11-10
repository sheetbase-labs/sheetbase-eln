import type { UseQueryResult } from '@tanstack/react-query'
import type {
  PluginBarcodeDrawing,
  layOutPluginLabel,
} from '#/lib/extensions/plugin-files'
import { parsePluginName } from '#/lib/extensions/points'
import { t } from '#/copy'

export interface PluginLabelState<T> {
  data?: T
  loading: boolean
  problem?: string
}

export interface PluginLabel {
  lines: PluginLabelState<Awaited<ReturnType<typeof layOutPluginLabel>>>
  code: PluginLabelState<PluginBarcodeDrawing>
}

/** Query's error contract is Error; retain the runtime string fallback too. */
export function pluginFailure(error: Error): string {
  return error instanceof Error ? error.message : String(error)
}

export function pluginLabelState<T>({
  name,
  available,
  ready,
  query,
  failure,
}: {
  name: string | null
  available: boolean
  ready: boolean
  query: UseQueryResult<T>
  failure: (error: Error) => string
}): PluginLabelState<T> {
  if (!name) return { loading: false }

  if (!available) {
    if (!ready) return { loading: true }
    const parsed = parsePluginName(name)

    return {
      loading: false,
      problem: t('plugins.labels.gone', { title: parsed?.id ?? name }),
    }
  }

  if (query.isError) return { loading: false, problem: failure(query.error) }

  return { loading: query.isPending, data: query.data }
}
