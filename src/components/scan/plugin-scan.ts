/**
 * Scanning with the barcode formats plugins add. A label printed with a plugin
 * format may carry something other than the sample's ID (a vendor's code, a
 * lot string); the format's reader turns it back into the ID. The text as
 * scanned is tried first, so a plain ID or a Sheetbase code never waits on a
 * plugin.
 */
import { useCallback } from 'react'

import { parseWithPluginBarcode } from '#/lib/extensions/plugin-files'
import { useExtensionPoints } from '#/lib/extensions/use-extension-points'
import { resolveScanCode } from './scan-data'
import type { ScanResolution } from './scan-data'

export function useScanCodeResolver(): (
  code: string,
) => Promise<ScanResolution> {
  const readers = useExtensionPoints().data['barcode-formats'].filter(
    (item) => item.declaration.parse,
  )

  return useCallback(
    async (code: string) => {
      const plain = await resolveScanCode(code)

      if (plain.found || readers.length === 0) return plain

      for (const reader of readers) {
        let value: string | null = null

        try {
          value = await parseWithPluginBarcode({
            extensionKey: reader.extensionKey,
            formatId: reader.id,
            text: code.trim(),
          })
        } catch {
          // A reader that can't run is skipped; the person still gets the plain miss.
          continue
        }

        if (!value || value === code.trim()) continue
        const resolved = await resolveScanCode(value)

        if (resolved.found) return { ...resolved, code: code.trim() }
      }

      return plain
    },
    [readers],
  )
}
