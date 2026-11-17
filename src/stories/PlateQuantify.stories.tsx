import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  QuantifyResultsTab,
  StandardCurveTab,
} from '#/components/plates/quantify-tabs'
import { StandardCurvePlot } from '#/components/plates/standard-curve-plot'
import { quantifyPlate } from '#/lib/plate-quantify'
import type { QuantifyWell } from '#/lib/plate-quantify'

/**
 * A plate read off a standard curve: seven standards in duplicate, then six
 * samples, each with its result in the assay's unit.
 */
const standards = [1000, 500, 250, 125, 62.5, 31.25, 15.6]
const wells: QuantifyWell[] = []
const readings: Record<string, number> = {}

standards.forEach((concentration, row) => {
  for (const col of [1, 2]) {
    const wellCode = `${'ABCDEFGH'[row]}${col}`

    wells.push({
      wellCode,
      role: 'standard',
      concentration,
      concentrationUnit: 'ng/mL',
    })
    readings[wellCode] = 0.05 + 2.45 / (1 + (250 / concentration) ** 1.1)
  }
})

;[
  'SMP-2231',
  'SMP-2240',
  'SMP-2241',
  'SMP-2242',
  'SMP-2243',
  'SMP-2244',
].forEach((label, index) => {
  for (const col of [3, 4]) {
    const wellCode = `${'ABCDEF'[index]}${col}`

    wells.push({
      wellCode,
      role: 'sample',
      sampleLabel: label,
      sampleId: `00000000-0000-4000-8000-00000000030${index}`,
    })
    readings[wellCode] = 0.3 + index * 0.35
  }
})

const result = quantifyPlate(wells, (code) => readings[code] ?? null, {
  model: '4pl',
  dilutionFactor: 1,
})

const meta = {
  title: 'Plates/Standard curve',
  component: QuantifyResultsTab,
  tags: ['autodocs'],
  args: { result },
  decorators: [
    (Story) => (
      <QueryClientProvider client={new QueryClient()}>
        <Story />
      </QueryClientProvider>
    ),
  ],
} satisfies Meta<typeof QuantifyResultsTab>

export default meta

type Story = StoryObj<typeof meta>

export const Results: Story = {}

export const CurveTab: Story = {
  render: () => <StandardCurveTab result={result} />,
}

export const CurvePlot: Story = {
  render: () => <StandardCurvePlot result={result} />,
}
