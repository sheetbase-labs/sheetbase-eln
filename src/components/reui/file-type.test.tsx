import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { FileType, getFileType, getFileTypeCategory } from './file-type'

/**
 * The icon's two contracts: turning a name, URL or media type into a type, and
 * rendering that type with the name and the label band it implies.
 *
 * The resolution cases are here because the tables are read through one
 * `lookup` rather than widened to dictionaries; these are the paths that read
 * them — an extension, a URL path, a media type, a media subtype, a name family
 * and an unknown value.
 */

afterEach(cleanup)

describe('getFileType', () => {
  it('resolves an extension whatever its case', () => {
    expect(getFileType('report.PDF')).toBe('pdf')
  })

  it('reads a URL by its path', () => {
    expect(getFileType('https://example.com/data/plate-01.csv?x=1')).toBe('csv')
  })

  it('resolves a media type to the extension it names', () => {
    expect(getFileType('image/png')).toBe('png')
  })

  it('falls back to the media type\u2019s family when the subtype names nothing', () => {
    expect(getFileType('image/x-unknown')).toBe('image')
  })

  it('reads a storage key after the dot that starts its extension', () => {
    expect(getFileType('image/a.png')).toBe('png')
  })

  it('resolves a well-known name that has no extension of its own', () => {
    expect(getFileType('Dockerfile.dev')).toBe('dockerfile')
  })

  it('reads the last extension of a compound name', () => {
    expect(getFileType('archive.tar.gz')).toBe('gz')
  })

  it('gives a name it does not know no type at all', () => {
    expect(getFileType('notes')).toBe('empty')
  })
})

describe('getFileTypeCategory', () => {
  it('groups a type by the family it belongs to', () => {
    expect(getFileTypeCategory('pdf')).toBe('document')
    expect(getFileTypeCategory('png')).toBe('image')
  })

  it('groups every unknown value as a file', () => {
    expect(getFileTypeCategory('not-a-type')).toBe('file')
  })
})

describe('FileType', () => {
  it('names the icon from its format', () => {
    render(<FileType type="pdf" />)

    expect(screen.getByRole('img', { name: 'PDF file' })).toBeTruthy()
    expect(screen.getByText('PDF')).toBeTruthy()
  })

  it('spells out a name its label shortens', () => {
    render(<FileType type="dockerfile" />)

    expect(screen.getByRole('img', { name: 'DOCKERFILE file' })).toBeTruthy()
    expect(screen.getByText('DOCK')).toBeTruthy()
  })

  it('adds a custom text label to the name, once', () => {
    render(<FileType type="docx" label="V3" />)

    expect(screen.getByRole('img', { name: 'V3, DOCX file' })).toBeTruthy()
    expect(screen.getByText('V3')).toBeTruthy()
  })

  it('draws a node label in the band and names the icon by its format', () => {
    const { container } = render(
      <FileType type="docx" label={<span>V3</span>} />,
    )

    expect(screen.getByRole('img', { name: 'DOCX file' })).toBeTruthy()
    expect(
      container.querySelector('[data-slot="file-type-label"]')?.textContent,
    ).toBe('V3')
  })

  it('shows the glyph instead of the band for a family', () => {
    const { container } = render(<FileType type="image" glyph />)

    expect(
      container.querySelector('[data-slot="file-type-glyph"]'),
    ).toBeTruthy()
    expect(container.querySelector('[data-slot="file-type-label"]')).toBeNull()
  })

  it('draws a custom icon in place of both the glyph and the band', () => {
    const { container } = render(
      <FileType type="pdf" icon={<svg aria-hidden="true" />} />,
    )

    expect(
      container.querySelector('[data-slot="file-type-custom-icon"]'),
    ).toBeTruthy()
    expect(container.querySelector('[data-slot="file-type-label"]')).toBeNull()
    expect(container.querySelector('[data-slot="file-type-glyph"]')).toBeNull()
  })

  it('renders a neutral page for a type it does not know', () => {
    render(<FileType type="not-a-type" />)

    expect(screen.getByRole('img', { name: 'NOT-A-TYPE file' })).toBeTruthy()
    expect(screen.getByText('NOT-A-TYPE')).toBeTruthy()
  })
})
