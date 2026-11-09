// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  WopiLocks,
  editableExtension,
  editorActionUrl,
  editorFormAction,
  officeEditorConfig,
  signWopiToken,
  verifyWopiToken,
} from './office-editor'

const SECRET = 'x'.repeat(40)

const claims = {
  fileRecordId: 'f1',
  userId: 'u1',
  userName: 'Ada',
  workspaceId: 'w1',
  sessionId: 's1',
  canWrite: true,
  hostRecordId: 'r1',
}

describe('editableExtension', () => {
  it('opens Word, Excel, PowerPoint and OpenDocument files, old and new', () => {
    for (const name of [
      'a.docx',
      'b.DOC',
      'c.xlsx',
      'd.xls',
      'e.pptx',
      'f.ppt',
      'g.odt',
      'h.ods',
      'i.odp',
    ]) {
      expect(editableExtension(name)).not.toBeNull()
    }
  })
  it('leaves other files alone', () => {
    for (const name of ['a.pdf', 'b.csv', 'c.png', 'noext']) {
      expect(editableExtension(name)).toBeNull()
    }
  })
})

describe('officeEditorConfig', () => {
  it('is off without OFFICE_EDITOR_URL', () => {
    expect(officeEditorConfig({ BETTER_AUTH_URL: 'http://app' })).toBeNull()
  })
  it('defaults the WOPI host to the app address and trims slashes', () => {
    expect(
      officeEditorConfig({
        OFFICE_EDITOR_URL: 'https://office.example/',
        BETTER_AUTH_URL: 'https://app.example/',
      }),
    ).toEqual({
      editorUrl: 'https://office.example',
      wopiHostUrl: 'https://app.example',
    })
  })
  it('uses the private WOPI host when set', () => {
    expect(
      officeEditorConfig({
        OFFICE_EDITOR_URL: 'https://office.example',
        OFFICE_EDITOR_WOPI_HOST_URL: 'http://app:3000',
        BETTER_AUTH_URL: 'https://app.example',
      })?.wopiHostUrl,
    ).toBe('http://app:3000')
  })
})

describe('WOPI access tokens', () => {
  it('round-trips the claims', async () => {
    const token = await signWopiToken(SECRET, claims)
    expect(await verifyWopiToken(SECRET, token)).toEqual(claims)
  })
  it('rejects another secret, tampering and expiry', async () => {
    const token = await signWopiToken(SECRET, claims)
    expect(await verifyWopiToken('y'.repeat(40), token)).toBeNull()
    expect(await verifyWopiToken(SECRET, `${token}x`)).toBeNull()
    const expired = await signWopiToken(SECRET, claims, -10)
    expect(await verifyWopiToken(SECRET, expired)).toBeNull()
  })
  it('is not a usable database token', async () => {
    const { jwtVerify } = await import('jose')
    const token = await signWopiToken(SECRET, claims)
    await expect(
      jwtVerify(token, new TextEncoder().encode(SECRET)),
    ).rejects.toThrow()
  })
})

describe('discovery', () => {
  const xml = `<wopi-discovery><net-zone name="external-http">
    <app name="writer"><action urlsrc="https://o/browser/abc/cool.html?" ext="docx" name="edit" />
    <action ext="docx" name="view" urlsrc="https://o/browser/abc/cool.html?a=1&amp;b=2"/></app>
  </net-zone></wopi-discovery>`

  it('finds the action whatever the attribute order', () => {
    expect(editorActionUrl(xml, 'docx', 'edit')).toBe(
      'https://o/browser/abc/cool.html?',
    )
    expect(editorActionUrl(xml, 'docx', 'view')).toBe(
      'https://o/browser/abc/cool.html?a=1&b=2',
    )
    expect(editorActionUrl(xml, 'xlsx')).toBeNull()
  })
  it('appends WOPISrc cleanly', () => {
    expect(editorFormAction('https://o/c.html?', 'http://a/f')).toBe(
      'https://o/c.html?WOPISrc=http%3A%2F%2Fa%2Ff',
    )
    expect(editorFormAction('https://o/c.html?x=1', 'http://a/f')).toBe(
      'https://o/c.html?x=1&WOPISrc=http%3A%2F%2Fa%2Ff',
    )
  })
})

describe('WopiLocks', () => {
  it('holds, conflicts, refreshes and releases', () => {
    const now = 0
    const locks = new WopiLocks(() => now)
    expect(locks.lock('f', 'a')).toEqual({ ok: true })
    expect(locks.lock('f', 'b')).toEqual({ ok: false, held: 'a' })
    expect(locks.lock('f', 'a')).toEqual({ ok: true })
    expect(locks.allowsWrite('f', 'a')).toBe(true)
    expect(locks.allowsWrite('f', 'b')).toBe(false)
    expect(locks.unlock('f', 'b').ok).toBe(false)
    expect(locks.unlock('f', 'a').ok).toBe(true)
    expect(locks.allowsWrite('f', null)).toBe(true)
  })
  it('lapses when not refreshed', () => {
    let now = 0
    const locks = new WopiLocks(() => now)
    locks.lock('f', 'a')
    now = 31 * 60 * 1000
    expect(locks.current('f')).toBeNull()
  })
})
