import { createContext } from 'react'

/**
 * How a `Section` (ui/layout.tsx) lays itself out. Pages stack their
 * sections, a heading over its content. The settings shell sets `settings`:
 * each section becomes a row with its heading and description in a column on
 * the left and its controls on the right. A section inside one of those is
 * `nested`, a plain sub-heading in the right-hand column. Dialogs and sheets
 * put it back to `stack`, so a form in a dialog opened from Settings is not
 * split into columns.
 */
export type SectionLayoutMode = 'stack' | 'settings' | 'nested'

export const SectionLayoutContext = createContext<SectionLayoutMode>('stack')
