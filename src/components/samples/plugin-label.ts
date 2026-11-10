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
import { useExtensionPointsState } from '#/lib/extensions/use-extension-points'
import { isPluginItem } from '#/lib/labels'
import { t } from '#/copy'

import { pluginFailure, pluginLabelState } from './plugin-label-state'
import type { PluginLabel } from './plugin-label-state'

export type { PluginLabel, PluginLabelState } from './plugin-label-state'

export function usePluginLabel(args: {
  layout: string | undefined
  barcodeType: string
  recordKind: string
  identifier: string
  record: Parameters<typeof layOutPluginLabel>[0]['record']
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

  return {
    lines: pluginLabelState({
      name: layoutName,
      available: Boolean(layoutItem),
      ready,
      query: lines,
      failure: (error) =>
        t('plugins.labels.layoutFailed', {
          title: layoutItem!.declaration.title,
          reason: pluginFailure(error),
        }),
    }),
    code: pluginLabelState({
      name: codeName,
      available: Boolean(codeItem),
      ready,
      query: code,
      failure: pluginFailure,
    }),
  }
}
