import { lazy, Suspense, useState } from 'react'
import type { ComponentProps, ComponentType } from 'react'

import type { SearchPalette as SearchPaletteComponent } from '#/components/v3/search/search-palette'
import type { RegistryShortcutsDialog as ShortcutsDialogComponent } from '#/components/shortcuts/shortcuts-dialog'

const SearchPalette = lazy(() =>
  import('#/components/v3/search/search-palette').then((module) => ({
    default: module.SearchPalette,
  })),
)
const ShortcutsDialog = lazy(() =>
  import('#/components/shortcuts/shortcuts-dialog').then((module) => ({
    default: module.RegistryShortcutsDialog as ComponentType<
      ComponentProps<typeof ShortcutsDialogComponent>
    >,
  })),
)

/**
 * Mount an overlay's code only once it is first opened. The search palette and
 * the shortcuts dialog are closed on almost every page view, so keeping them
 * out of the first load costs nothing a person can see: the code arrives with
 * the keystroke that opens them, and stays mounted after.
 */
function useEverOpen(open: boolean | undefined): boolean {
  const [everOpen, setEverOpen] = useState(Boolean(open))
  if (open && !everOpen) setEverOpen(true)
  return everOpen
}

export function LazySearchPalette(
  props: ComponentProps<typeof SearchPaletteComponent>,
) {
  const mounted = useEverOpen(props.open)
  if (!mounted) return null
  return (
    <Suspense fallback={null}>
      <SearchPalette {...props} />
    </Suspense>
  )
}

export function LazyShortcutsDialog(
  props: ComponentProps<typeof ShortcutsDialogComponent>,
) {
  const mounted = useEverOpen(props.open)
  if (!mounted) return null
  return (
    <Suspense fallback={null}>
      <ShortcutsDialog {...props} />
    </Suspense>
  )
}
