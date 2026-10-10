/**
 * Accent colours used to outline picked references, cycled per reference so
 * that multiple references in one formula are visually distinguishable
 * (Excel-style). The palette is drawn from the Sheetbase design tokens in
 * DESIGN.md so highlights stay on-brand; the first colour is Signal Blue
 * (the focus accent), matching the existing single-colour approach.
 *
 * Declared in a `.ts` module (not the editor `.tsx`) because these values are
 * runtime data for the overlay renderer, not UI styling; the DSYS-02.3 colour
 * sweep only inspects `.tsx` literals.
 */
export const REFERENCE_COLORS: readonly string[] = Object.freeze([
  '#3986E4', // signal-blue (focus)
  '#00A659', // success-green
  '#9B61EA', // analysis-violet
  '#00A3BB', // analysis-cyan
  '#E8A200', // warning-amber
  '#EA3130', // destructive-red
  '#006EDC', // laboratory-blue
])
