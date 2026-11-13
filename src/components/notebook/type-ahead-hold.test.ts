// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { holdTypeAhead } from './type-ahead-hold'

function typeInto(root: HTMLElement, inputType: string, data?: string) {
  const event = new InputEvent('beforeinput', {
    inputType,
    data,
    cancelable: true,
    bubbles: true,
  })

  root.dispatchEvent(event)

  return event
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('holdTypeAhead', () => {
  it('keeps typing out of the old block and types it into the new one', async () => {
    document.body.innerHTML =
      '<div id="root"><div id="new" tabindex="0"><div id="field" contenteditable="true"></div></div></div>'
    const root = document.getElementById('root')!
    const next = document.getElementById('new')!
    const typed: string[] = []

    const hold = holdTypeAhead(root, (text) => typed.push(text))

    expect(typeInto(root, 'insertText', 'a').defaultPrevented).toBe(true)
    typeInto(root, 'insertText', 'b')
    typeInto(root, 'insertText', 'c')
    typeInto(root, 'deleteContentBackward')

    // jsdom does not compute `isContentEditable`, so state it.
    const field = document.getElementById('field')!
    Object.defineProperty(field, 'isContentEditable', { value: true })
    field.focus()
    await hold.release(() => next)

    expect(typed).toEqual(['ab'])
  })

  it('holds a plain key pressed while no text field has the cursor', async () => {
    document.body.innerHTML =
      '<div id="root"><div id="frame" tabindex="0"></div></div>'
    const root = document.getElementById('root')!
    const frame = document.getElementById('frame')!
    const typed: string[] = []

    const hold = holdTypeAhead(root, (text) => typed.push(text))

    const key = new KeyboardEvent('keydown', {
      key: 'e',
      cancelable: true,
      bubbles: true,
    })

    frame.dispatchEvent(key)

    expect(key.defaultPrevented).toBe(true)

    const field = document.createElement('div')
    Object.defineProperty(field, 'isContentEditable', { value: true })
    field.tabIndex = 0
    frame.append(field)
    field.focus()
    await hold.release(() => frame)

    expect(typed).toEqual(['e'])
  })

  it('stops holding once released', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const root = document.getElementById('root')!
    const hold = holdTypeAhead(root, () => undefined)

    await hold.release(null)

    expect(typeInto(root, 'insertText', 'x').defaultPrevented).toBe(false)
  })
})
