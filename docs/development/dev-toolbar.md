# Dev toolbar

A thin bar docked to the bottom of the page, after the internal toolbar Linear
describes in
[Behind the latest design refresh](https://linear.app/now/behind-the-latest-design-refresh).
It is for choosing feature flags, watching performance and running developer
actions. Everything it does is local to the browser; nothing is saved to the
server.

## Who sees it

- Development builds (`pnpm dev`): everyone, as a bar along the bottom of the
  page. Automated browsers (Playwright) and the parity build (`VITE_PARITY`)
  don't see it unless it was switched on.
- Production builds: only workspace owners and admins, and only after they press
  **Ctrl + Alt + D**. Ctrl + Alt + D shows or hides it everywhere, and the choice
  is remembered in `localStorage` (`sb-devtools`).

The bar overlays the bottom 36px of the page. Flags and network simulation only
count while the bar is up, so a stale setting never affects someone it was not
meant for.

## Feature flags

`src/lib/dev-flags.ts` is the registry. A flag can switch a feature **off** for
this browser; it never grants anything, and the deployment, workspace settings
and PostgreSQL RLS stay authoritative. Today:

- **Live updates**: stops the event stream (`LiveEventProvider`).
- **Real-time collaboration**: hides shared cursors and comments
  (`useCollaborationEnabled`).

To add one, add an entry to `devFlags` and read it with `useDevFlag(key)` where
the feature starts. Deployment capabilities (`SHEETBASE_CAPABILITIES`) have no
registered key yet, so there is nothing to list from them.

## Performance

The bar shows frame rate, LCP, CLS, INP, JS heap (Chromium) and requests in
flight, coloured by the Web Vitals bands. Click it for long tasks, DOM size,
cached and fetching queries, average and slowest request, and the last 15 data
requests with status and time (`src/lib/dev-network.ts` logs them from the data
client).

## Network

Two selects in the bar add latency (+300 ms, +1 s, +3 s) and make a share of
data requests fail (10%, 50%) or all of them (offline), to feel a slow or broken
API. Failures are a simulated 503 and never reach the server.

## Actions

Refetch all data, clear the data cache, reload, reset local state and reload,
copy debug info (URL, role, mode, viewport, flags, network settings), and show a
test notification.

## Not built yet

- A locale switch for the stretched test language: `VITE_SHEETBASE_LOCALE=pseudo`
  is chosen at build time, so it can't be flipped at runtime.
- Switching workspace settings flags (the AI flags) from the bar: they are real
  workspace settings with their own page and permissions.
