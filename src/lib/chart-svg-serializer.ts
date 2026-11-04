/**
 * The charts package's SVG export helper, registered by the chart renderer
 * when it loads. The renderer (and the package) load on demand, so code that
 * exports a drawn chart reads the helper from here instead of importing the
 * package and pulling it into every page. A chart that is on screen to export
 * has always loaded the renderer, so the helper is there when it is needed.
 */
type SerializeChartSvg = (container: HTMLElement) => string | undefined

let serializer: SerializeChartSvg | null = null

export function registerChartSvgSerializer(fn: SerializeChartSvg): void {
  serializer = fn
}

/** The package's serialisation of a drawn chart, or undefined if unavailable. */
export function serializeDrawnChart(
  container: HTMLElement,
): string | undefined {
  return serializer?.(container)
}
