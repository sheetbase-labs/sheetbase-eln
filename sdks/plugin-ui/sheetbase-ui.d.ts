/**
 * Types for the Sheetbase plugin UI SDK, `window.sheetbase`. Sheetbase adds
 * the SDK to your page when it serves it; this file only describes it, so your
 * TypeScript knows what is there.
 *
 * In a tsconfig: `"types": ["@sheetbase-labs/plugin-ui/types"]`, or a
 * `/// <reference path="…/sheetbase-ui.d.ts" />` line.
 */

type HostCapabilityName =
  | 'blocks.list'
  | 'blocks.insertBelow'
  | 'files.list'
  | 'files.read'
  | 'registry.models'
  | 'registry.findDuplicates'
  | 'registry.create'
  /** Any MCP tool by its name, such as `sheetbase.lab.act` or `sheetbase.canonical.read`. */
  | `sheetbase.${string}`

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

/** What a table cell renderer hands back for one cell. */
interface RenderedCell {
  key: number | string
  /** SVG markup. Sheetbase cleans it (no scripts, no external addresses). */
  svg?: string
  /** A `data:image/png;base64,…` (or jpeg, gif, webp) picture. */
  image?: string
  text?: string
  tone?: Tone
}

interface SheetbaseUi {
  readonly version: 1
  /**
   * Called now (if Sheetbase has already sent them) and each time it sends new
   * context and state. `context` depends on where the screen is: a block gets
   * `{ recordId, blockId }`, a form field `{ value, field }`, a report section
   * `{ recordId, reportId, projectId }`, a page `{ page }`, a widget `{ widget }`.
   */
  onContext<C = Record<string, unknown>, S = unknown>(
    fn: (context: C, state: S | null) => void,
  ): void
  /** Run one of this plugin's operations as the person using the screen. A write asks them first. */
  call<Out = Record<string, unknown>>(
    operation: string,
    input?: Record<string, unknown>,
  ): Promise<Out>
  /**
   * `fetch` for this plugin's own operations: `/operations/<id>` with a JSON
   * body. Any other address is refused. The global `fetch` is the same door.
   */
  fetch(
    url: string,
    init?: { method?: string; body?: string },
  ): Promise<Response>
  /**
   * Ask Sheetbase to do something for this screen, as the person using it. The
   * plugin declares the matching `permissions` in plugin.json (`projects:read`
   * for `blocks.list`, `projects:write` for `blocks.insertBelow` and
   * `registry.create`, `files:read` for `files.list` and `files.read`,
   * `models:read` for `registry.models` and `registry.findDuplicates`). A change
   * asks the person first. Rejects with an Error; `code` is `duplicate` when a
   * registry already holds the entry.
   */
  host<Out = unknown>(
    name: HostCapabilityName,
    input?: Record<string, unknown>,
  ): Promise<Out>
  /** Keep this data with the block (JSON). */
  setState(state: unknown): void
  notify(text: string, tone?: Tone): void
  resize(height: number): void
  /** A form field's screen: the field's new value. */
  setValue(value: string): void
  /** A report section's screen: what to freeze into the report. */
  setSection(section: { title: string; text: string }): void
  /** Go to a place in Sheetbase, such as `/experiments`. Same-site paths only. */
  navigate(path: string): void
  /**
   * A table cell renderer: `[{ key, value }]` in, `[{ key, svg | image | text, tone }]` out.
   */
  onRender(
    fn: (
      cells: Array<{ key: number | string; value: unknown }>,
      context: Record<string, unknown>,
    ) => RenderedCell[] | Promise<RenderedCell[]>,
  ): void
}

declare const sheetbase: SheetbaseUi
interface Window {
  sheetbase: SheetbaseUi
}
