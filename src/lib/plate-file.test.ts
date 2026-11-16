import { describe, expect, it } from 'vitest'

import { decodePlateText, platesInText } from './plate-file'

const grid = [
  'Protocol,Kinase screen',
  'Date,2026-11-16',
  '',
  ',1,2,3,4',
  'A,10,20,30,40',
  'B,11,21,31,41',
  'C,12,22,32,42',
].join('\n')

describe('platesInText', () => {
  it('finds a grid below a preamble', () => {
    const found = platesInText(grid, 'run.csv')

    expect(found).toHaveLength(1)
    expect(found[0].layout).toBe('grid')
    expect(found[0].readings).toBe(12)
  })

  it('reads tab separated exports', () => {
    const found = platesInText(grid.replaceAll(',', '\t'), 'run.txt')

    expect(found).toHaveLength(1)
    expect(found[0].readings).toBe(12)
  })

  it('finds every plate in a file and labels them', () => {
    const found = platesInText(`${grid}\n\n${grid}`, 'two.csv')

    expect(found).toHaveLength(2)
    expect(found.map((c) => c.label)).toEqual(['two.csv · 1', 'two.csv · 2'])
    expect(new Set(found.map((c) => c.id)).size).toBe(2)
  })

  it('reads a list with a well column', () => {
    const found = platesInText('well,value\nA1,5\nA2,6\nB1,7', 'list.csv')

    expect(found).toHaveLength(1)
    expect(found[0].layout).toBe('list')
    expect(found[0].readings).toBe(3)
  })

  it('finds nothing in text that is not a plate', () => {
    expect(platesInText('name,age\nAda,36', 'x.csv')).toEqual([])
  })

  it('finds each plate of a list that has a plate column', () => {
    const lines = ['Plate,Well,Signal']

    for (const plate of ['P1', 'P2', 'P3'])
      for (const well of ['A01', 'A02', 'B01'])
        lines.push(`${plate},${well},${plate.length * 10}`)

    const found = platesInText(lines.join('\n'), 'screen.csv')

    expect(found.map((c) => c.label)).toEqual([
      'screen.csv · P1',
      'screen.csv · P2',
      'screen.csv · P3',
    ])
    expect(found.every((c) => c.readings === 3)).toBe(true)
  })

  it('reads a list whose header is below a preamble', () => {
    const found = platesInText('Report\nRun 4\nWell,Value\nA1,5\nA2,6', 'l.csv')

    expect(found).toHaveLength(1)
    expect(found[0].readings).toBe(2)
  })

  it('keeps a thousands separator as a thousand, not a decimal', () => {
    const text = ['"",1,2,3', 'A,"44,210","1,000",5', 'B,6,7,8'].join('\n')

    const [plate] = platesInText(text, 'q.csv')

    expect(plate.text).toContain('44210')
    expect(plate.text).toContain('1000')
  })

  it('reads a decimal comma in a semicolon file, whatever the preamble holds', () => {
    const text = [
      'Application: Tecan i-control , 2.0.10.0',
      'Temperature: 24,6 °C',
      '',
      '<>;1;2;3',
      'A;1,5;OVER;3,25',
      'B;4;5;6',
    ].join('\n')

    const [plate] = platesInText(text, 'tecan.csv')

    expect(plate.readings).toBe(5)
    expect(plate.text).toContain('1.5')
    expect(plate.text).toContain('3.25')
  })

  it('names plates by the title the reader printed above each', () => {
    const one = [
      'Plate: Rep1',
      'Label: Label1',
      '',
      ';1;2;3',
      'A;1;2;3',
      'B;4;5;6',
    ]

    const two = [
      'Plate: Rep2',
      'Label: Label2',
      '',
      ';1;2;3',
      'A;1;2;3',
      'B;4;5;6',
    ]

    const found = platesInText([...one, '', ...two].join('\n'), 'f.csv')

    expect(found.map((c) => c.label)).toEqual(['f.csv · Rep1', 'f.csv · Rep2'])
  })

  it('takes a lone "Plate 2" line as the plate\'s name', () => {
    const titled = ['Plate 2', '', ',1,2,3', 'A,1,2,3', 'B,4,5,6']

    expect(platesInText(titled.join('\n'), 'w.csv')[0].title).toBe('Plate 2')
  })

  it('gives unlettered rows their letters when they fill a plate', () => {
    const rows = Array.from(
      { length: 8 },
      (_, r) =>
        `\t${r === 0 ? '24.1' : ''}\t${Array.from({ length: 12 }, (_unused, c) => (r + 1) * (c + 1)).join('\t')}`,
    )

    const found = platesInText(
      [
        'Plate:\tPlate#1',
        `\tTemperature\t${Array.from({ length: 12 }, (_, i) => i + 1).join('\t')}`,
        ...rows,
      ].join('\n'),
      'softmax.txt',
    )

    expect(found).toHaveLength(1)
    expect(found[0].readings).toBe(96)
    expect(found[0].format).toBe('96_well')
  })

  it('reads UTF-16 and Windows-1252 text', () => {
    const utf16 = new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0xb0, 0x00])

    expect(decodePlateText(utf16)).toBe('A°')
    expect(decodePlateText(new Uint8Array([0x32, 0x34, 0xb0, 0x43]))).toBe(
      '24°C',
    )
  })
})
