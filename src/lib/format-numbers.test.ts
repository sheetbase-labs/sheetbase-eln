import { describe, expect, it } from 'vitest'

import {
  formatCount,
  formatMetricValue,
  formatCellValue,
  formatFileSize,
} from './format-numbers'

describe('formatCount', () => {
  it('formats integers with thousands separators', () => {
    expect(formatCount(23100000)).toBe('23,100,000')
    expect(formatCount(1000)).toBe('1,000')
    expect(formatCount(28)).toBe('28')
    expect(formatCount(0)).toBe('0')
  })

  it('handles negative integers', () => {
    expect(formatCount(-1234567)).toBe('-1,234,567')
  })

  it('uses scientific notation for very large decimals', () => {
    expect(formatCount(1234567.5)).toBe('1.23e6')
  })

  it('uses scientific notation for very small decimals', () => {
    expect(formatCount(0.00042)).toBe('4.20e-4')
  })

  it('formats moderate decimals with up to 3 significant digits', () => {
    expect(formatCount(7.2)).toBe('7.2')
    expect(formatCount(3.14159)).toBe('3.14')
  })

  it('returns an em dash for non-finite values', () => {
    expect(formatCount(Number.NaN)).toBe('—')
    expect(formatCount(Number.POSITIVE_INFINITY)).toBe('—')
  })
})

describe('formatMetricValue', () => {
  it('parses numeric strings and formats them', () => {
    expect(formatMetricValue('23100000')).toBe('23,100,000')
    expect(formatMetricValue('7.2')).toBe('7.2')
  })

  it('leaves human-readable strings untouched', () => {
    expect(formatMetricValue('4 °C')).toBe('4 °C')
    expect(formatMetricValue('EXP-2025-0014')).toBe('EXP-2025-0014')
    expect(formatMetricValue('Pass')).toBe('Pass')
  })

  it('formats numbers directly', () => {
    expect(formatMetricValue(1000)).toBe('1,000')
  })

  it('handles null and undefined', () => {
    expect(formatMetricValue(null)).toBe('')
    expect(formatMetricValue(undefined)).toBe('')
  })
})

describe('formatCellValue', () => {
  it('formats numbers', () => {
    expect(formatCellValue(23100000)).toBe('23,100,000')
    expect(formatCellValue(28)).toBe('28')
  })

  it('returns empty string for null and undefined', () => {
    expect(formatCellValue(null)).toBe('')
    expect(formatCellValue(undefined)).toBe('')
  })

  it('stringifies other values', () => {
    expect(formatCellValue('x')).toBe('x')
    expect(formatCellValue(true)).toBe('true')
  })
})

describe('formatFileSize', () => {
  it('formats bytes below 1 KiB as raw bytes', () => {
    expect(formatFileSize(512)).toBe('512 B')
  })

  it('formats kilobytes with no decimal', () => {
    expect(formatFileSize(348160)).toBe('340 KB')
  })

  it('formats megabytes with one decimal', () => {
    expect(formatFileSize(13200580)).toBe('12.6 MB')
  })

  it('formats gigabytes with one decimal', () => {
    expect(formatFileSize(1503238553)).toBe('1.4 GB')
  })

  it('returns an em dash for non-finite or negative values', () => {
    expect(formatFileSize(Number.NaN)).toBe('—')
    expect(formatFileSize(-1)).toBe('—')
  })
})
