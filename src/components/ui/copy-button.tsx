import { Button } from './button'
import { copyText } from './copy-text'
import type { CopyTextOptions } from './copy-text'

export { copyText } from './copy-text'

/**
 * Copy one value, and report what actually happened.
 *
 * Nine files hand-rolled `navigator.clipboard.writeText`: five of them for a
 * single value beside a control, with the try/catch, the two message strings and
 * the success/failure honesty written out each time. `copyText` is that
 * behaviour in one place — a refused or absent clipboard means no copy
 * happened, and the user is told that rather than congratulated — and
 * `CopyButton` is the control for the button-shaped sites.
 *
 * The feedback is the app's toast, which is what every migrated site already
 * used, so the vocabulary does not change.
 *
 * Not for: copying the reader's *text selection* (`window.getSelection`), where
 * there is no value to hand over and the control is an action rather than a
 * value's affordance; that stays with the surface that owns the selection.
 */

export type CopyButtonProps = Omit<
  React.ComponentProps<typeof Button>,
  'onClick' | 'icon' | 'value'
> & {
  /**
   * What reaches the clipboard. A function is read at click time, for values
   * only the browser knows (the page URL) that must not be read while rendering
   * on the server.
   */
  readonly value: string | (() => string)
  /**
   * Visible label. Omit for an icon-only control, which then needs an
   * `aria-label` naming the value it copies.
   */
  readonly children?: React.ReactNode
}

/**
 * Resolve the prop: a string is copied as it stands, a thunk is read at click
 * time so a server render never touches a browser-only value.
 */
function readCopyValue(value: string | (() => string)): string {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- `value` is the already-typed string-or-thunk prop contract; the thunk exists precisely so the browser value is read at click time, and there is no other way to tell the two members apart.
  return typeof value === 'function' ? value() : value
}

export function CopyButton({
  value,
  children,
  size = 'sm',
  variant = 'quiet',
  copiedMessage,
  failedMessage,
  ...props
}: CopyButtonProps & CopyTextOptions) {
  return (
    <Button
      size={size}
      variant={variant}
      icon="copy"
      data-slot="copy-button"
      onClick={() =>
        void copyText(readCopyValue(value), {
          copiedMessage,
          failedMessage,
        })
      }
      {...props}
    >
      {children}
    </Button>
  )
}
