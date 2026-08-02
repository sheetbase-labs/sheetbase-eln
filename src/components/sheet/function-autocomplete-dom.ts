import {
  extractFunctionPrefix,
  getFunctionSuggestions,
} from '#/lib/function-descriptions'
import type { FunctionSuggestion } from '#/lib/function-descriptions'

/**
 * Vanilla-DOM function autocomplete manager for use inside Handsontable
 * editors (which are not React components). It attaches to a textarea,
 * detects partial function names at the cursor, and shows a floating
 * dropdown of matching functions with keyboard navigation.
 *
 * This coexists with {@link FormulaReferenceEditor}'s reference-picking:
 * Arrow/Tab/Enter are intercepted only while the dropdown is open, so
 * clicking cells to insert A1 references continues to work normally.
 */
export class FunctionAutocompleteDom {
  private _textarea: HTMLInputElement | HTMLTextAreaElement
  private _dropdown: HTMLDivElement | null = null
  private _suggestions: FunctionSuggestion[] = []
  private _activeIndex = -1
  private _onKeyDown = (event: Event): void =>
    this.handleKeyDown(event as KeyboardEvent)
  private _onInput = (): void => this.recompute()

  constructor(textarea: HTMLInputElement | HTMLTextAreaElement) {
    this._textarea = textarea
    textarea.addEventListener('keydown', this._onKeyDown, true)
    textarea.addEventListener('input', this._onInput)
  }

  /** Clean up all DOM elements and listeners. Safe to call multiple times. */
  destroy(): void {
    this._textarea.removeEventListener('keydown', this._onKeyDown, true)
    this._textarea.removeEventListener('input', this._onInput)
    this.hide()
  }

  /** Whether the dropdown is currently visible. */
  get isOpen(): boolean {
    return this._dropdown !== null
  }

  private recompute(): void {
    const cursor = this._textarea.selectionStart ?? 0
    const value = this._textarea.value
    const prefix = extractFunctionPrefix(value, cursor)
    if (!prefix) {
      this.hide()
      return
    }
    const matches = getFunctionSuggestions(prefix)
    if (matches.length === 0) {
      this.hide()
      return
    }
    this._suggestions = matches
    this._activeIndex = 0
    this.show()
  }

  private show(): void {
    if (!this._dropdown) {
      this._dropdown = this._textarea.ownerDocument.createElement('div')
      this._dropdown.setAttribute('role', 'listbox')
      this._dropdown.style.cssText =
        'position:absolute;z-index:9999;max-height:16rem;overflow:auto;' +
        'width:18rem;border-radius:0.375rem;border:1px solid var(--border,hsl(214.3,31.8%,91.4%));' +
        'background:var(--popover,white);color:var(--popover-foreground,inherit);' +
        'box-shadow:0 4px 6px -1px rgba(0,0,0,.1);padding:0.25rem;font-size:0.75rem;'
      this._textarea.ownerDocument.body.appendChild(this._dropdown)
    }
    this.position()
    this.render()
  }

  private position(): void {
    if (!this._dropdown) return
    // Position below the textarea using its bounding rect.
    const rect = this._textarea.getBoundingClientRect()
    const doc = this._textarea.ownerDocument
    const scrollX = doc.defaultView?.scrollX ?? 0
    const scrollY = doc.defaultView?.scrollY ?? 0
    this._dropdown.style.left = `${rect.left + scrollX}px`
    this._dropdown.style.top = `${rect.bottom + scrollY + 4}px`
  }

  private render(): void {
    if (!this._dropdown) return
    const dropdown = this._dropdown
    const doc = dropdown.ownerDocument
    dropdown.innerHTML = ''
    this._suggestions.forEach((s, i) => {
      const item = doc.createElement('button')
      item.type = 'button'
      item.setAttribute('role', 'option')
      item.setAttribute('aria-selected', String(i === this._activeIndex))
      item.style.cssText =
        'display:flex;flex-direction:column;align-items:flex-start;' +
        'width:100%;border:none;border-radius:0.125rem;padding:0.375rem 0.5rem;' +
        'text-align:left;cursor:pointer;background:transparent;' +
        `color:inherit;${i === this._activeIndex ? 'background:var(--accent,hsl(214,32%,91%));' : ''}`
      const name = doc.createElement('span')
      name.textContent = s.id
      name.style.cssText = 'font-family:monospace;font-weight:500;'
      const desc = doc.createElement('span')
      desc.textContent = s.description
      desc.style.cssText = 'opacity:0.7;font-size:0.6875rem;'
      item.appendChild(name)
      item.appendChild(desc)
      item.addEventListener('mousedown', (e) => {
        e.preventDefault() // keep textarea focus
        this.accept(i)
      })
      item.addEventListener('mouseenter', () => {
        this._activeIndex = i
        this.render()
      })
      dropdown.appendChild(item)
    })
  }

  private hide(): void {
    if (this._dropdown) {
      this._dropdown.remove()
      this._dropdown = null
    }
    this._suggestions = []
    this._activeIndex = -1
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (this._suggestions.length === 0) return
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        event.stopPropagation()
        this._activeIndex = (this._activeIndex + 1) % this._suggestions.length
        this.render()
        break
      case 'ArrowUp':
        event.preventDefault()
        event.stopPropagation()
        this._activeIndex =
          this._activeIndex <= 0
            ? this._suggestions.length - 1
            : this._activeIndex - 1
        this.render()
        break
      case 'Tab':
      case 'Enter':
        if (this._activeIndex >= 0) {
          event.preventDefault()
          event.stopPropagation()
          this.accept(this._activeIndex)
        }
        break
      case 'Escape':
        event.preventDefault()
        event.stopPropagation()
        this.hide()
        break
    }
  }

  private accept(index: number): void {
    if (index < 0 || index >= this._suggestions.length) return
    const suggestion = this._suggestions[index]
    const textarea = this._textarea
    const cursor = textarea.selectionStart ?? textarea.value.length
    const value = textarea.value
    // Find the token span (same walk-back as extractFunctionPrefix).
    let start = cursor
    while (start > 0 && /[A-Za-z0-9_.]/.test(value[start - 1])) start--
    const insertText = `${suggestion.id}(`
    const newText = value.slice(0, start) + insertText + value.slice(cursor)
    textarea.value = newText
    const newCursor = start + insertText.length
    textarea.setSelectionRange(newCursor, newCursor)
    // Trigger an input event so Handsontable's editor picks up the change.
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    this.hide()
    textarea.focus()
  }
}
