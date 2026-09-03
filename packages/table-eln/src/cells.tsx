import type {
  SpreadsheetCellRenderContext,
  SpreadsheetProps,
} from 'sheetbase-table/dev'

/**
 * ELN cell presentation over the engine's `renderCell` seam.
 *
 * The renderer never changes stored values: it only reshapes what a cell
 * shows. Columns without a config entry keep the engine's default rendering.
 */
export type ElnStatusStyle = Readonly<{ label?: string; className: string }>

export type ElnColumnConfig =
  | Readonly<{
      kind: 'status'
      /** value → chip style; values without an entry use `fallbackClassName`. */
      palette: Readonly<Record<string, ElnStatusStyle>>
      fallbackClassName?: string
    }>
  | Readonly<{ kind: 'number'; unit?: string; precision?: number }>
  | Readonly<{ kind: 'record-reference' }>
  /** Canonical value → display label; unknown values render as-is. */
  | Readonly<{ kind: 'category'; labels: Readonly<Record<string, string>> }>

export interface ElnCellRendererConfig {
  /** columnId → ELN presentation. */
  columns: Readonly<Record<string, ElnColumnConfig>>
  /** Record UUID → display label. Pass a getter to read live label state per cell. */
  recordLabels?:
    | Readonly<Record<string, string>>
    | (() => Readonly<Record<string, string>>)
}

export function createElnCellRenderer(
  config: ElnCellRendererConfig,
): NonNullable<SpreadsheetProps['renderCell']> {
  const labels = () =>
    typeof config.recordLabels === 'function'
      ? config.recordLabels()
      : (config.recordLabels ?? {})
  return (context: SpreadsheetCellRenderContext) => {
    const column = context.field ? config.columns[context.field.id] : undefined
    if (!column) return undefined
    switch (column.kind) {
      case 'status': {
        if (context.display === '') return undefined
        const style = column.palette[context.display]
        return (
          <span
            data-eln-chip={context.display}
            className={style?.className ?? column.fallbackClassName}
          >
            {style?.label ?? context.display}
          </span>
        )
      }
      case 'number': {
        if (context.display === '') return undefined
        const numeric = Number(context.display)
        if (!Number.isFinite(numeric)) return undefined
        const text =
          column.precision !== undefined
            ? numeric.toFixed(column.precision)
            : context.display
        return column.unit ? `${text} ${column.unit}` : text
      }
      case 'record-reference': {
        if (context.display === '') return undefined
        return labels()[context.display] ?? context.display
      }
      case 'category': {
        if (context.display === '') return undefined
        return column.labels[context.display] ?? context.display
      }
    }
  }
}
