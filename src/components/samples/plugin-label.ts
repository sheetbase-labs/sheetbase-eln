/**
 * What the plugins installed in this workspace add to a printed label: a layout
 * (which lines print) and a code (bars or a grid). Both are asked for by name,
 * `plugin.<plugin>.<item>`, from the template. What comes back is data, so no
 * plugin code ever runs where a label is shown or printed.
 */
import { useQuery } from '@tanstack/react-query'

import {
  drawPluginBarcode,
  layOutPluginLabel,
} from '#/lib/extensions/plugin-files'
import type { PluginBarcodeDrawing } from '#/lib/extensions/plugin-files'
import { parsePluginName } from '#/lib/extensions/points'
import { useExtensionPointsState } from '#/lib/extensions/use-extension-points'
import { isPluginItem } from '#/lib/labels'
import { t } from '#/copy'

export interface PluginLabelState<T> {
  /** The plugin's answer, once it has come. */
  data?: T
  loading: boolean
  /** Why it can't be used, in words for the person. */
  problem?: string
}

const idle = { loading: false } as const

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export interface PluginLabel {
  lines: PluginLabelState<Array<{ text: string; bold: boolean }>>
  code: PluginLabelState<PluginBarcodeDrawing>
}

export function usePluginLabel(args: {
  layout: string | undefined
  barcodeType: string
  recordKind: string
  identifier: string
  record: Record<string, unknown>
  widthMm: number
  heightMm: number
}): PluginLabel {
  const { points, ready } = useExtensionPointsState()

  const layoutName =
    args.layout && isPluginItem(args.layout) ? args.layout : null

  const codeName = isPluginItem(args.barcodeType) ? args.barcodeType : null

  const layoutItem = layoutName
    ? points.data['label-formats'].find((item) => item.name === layoutName)
    : undefined

  const codeItem = codeName
    ? points.data['barcode-formats'].find((item) => item.name === codeName)
    : undefined

  const lines = useQuery({
    enabled: Boolean(layoutItem),
    queryKey: [
      'plugin-label-lines',
      layoutName,
      args.recordKind,
      args.record,
      args.widthMm,
      args.heightMm,
    ],
    queryFn: () =>
      layOutPluginLabel({
        extensionKey: layoutItem!.extensionKey,
        formatId: layoutItem!.id,
        recordKind: args.recordKind,
        record: args.record,
        template: { widthMm: args.widthMm, heightMm: args.heightMm },
      }),
    staleTime: 30_000,
    retry: false,
  })

  const code = useQuery({
    enabled: Boolean(codeItem),
    queryKey: ['plugin-label-code', codeName, args.identifier],
    queryFn: () =>
      drawPluginBarcode({
        extensionKey: codeItem!.extensionKey,
        formatId: codeItem!.id,
        value: args.identifier,
      }),
    staleTime: 30_000,
    retry: false,
  })

  const gone = (name: string) => {
    const parsed = parsePluginName(name)

    return t('plugins.labels.gone', { title: parsed?.id ?? name })
  }

  return {
    lines: !layoutName
      ? idle
      : !layoutItem
        ? ready
          ? { loading: false, problem: gone(layoutName) }
          : { loading: true }
        : lines.isError
          ? {
              loading: false,
              problem: t('plugins.labels.layoutFailed', {
                title: layoutItem.declaration.title,
                reason: reasonOf(lines.error),
              }),
            }
          : { loading: lines.isPending, data: lines.data },
    code: !codeName
      ? idle
      : !codeItem
        ? ready
          ? { loading: false, problem: gone(codeName) }
          : { loading: true }
        : code.isError
          ? { loading: false, problem: reasonOf(code.error) }
          : { loading: code.isPending, data: code.data },
  }
}
