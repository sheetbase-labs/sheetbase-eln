'use client'

import * as React from 'react'

/**
 * The application shell context (SHELL-01). The root route renders one
 * `ShellProvider` around the route tree for the recorded internal reference
 * routes (the `docs/*.md` operator documents, the foundations catalogue, the
 * printed-label redirect and the dev grid demo); every product route renders
 * the adopted v3 shell (`#/components/v3/shell/app-shell`) instead.
 *
 * The legacy ELN chrome that gave those routes their sidebar, top bar,
 * inspector slot and ⌘K palette — and the per-route `useShell()` config that
 * fed it — has been deleted: no route called the hook any more, and the v3
 * shell owns navigation, search, per-route slots and their shortcuts. What
 * remains here is the wrapper the root route renders, so those routes keep the
 * tree they had.
 */
export function ShellProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
