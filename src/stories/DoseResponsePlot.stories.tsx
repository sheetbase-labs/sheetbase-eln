import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { DoseResponsePlot } from '#/components/plates/dose-response-plot'
import type { SampleCurve } from '#/lib/plate-assay'

const curve: SampleCurve = {
  key: 'cmpd-1',
  sampleId: null,
  label: 'Compound 1',
  concentrationUnit: 'µM',
  points: [
    { x: 0.01, y: 98 },
    { x: 0.03, y: 95 },
    { x: 0.1, y: 84 },
    { x: 0.3, y: 61 },
    { x: 1, y: 38 },
    { x: 3, y: 17 },
    { x: 10, y: 6 },
    { x: 30, y: 2 },
  ],
  model: '4pl',
  ec50: 0.62,
  ec50Ci95: { lo: 0.5, hi: 0.77 },
  ec50Molar: 6.2e-7,
  hill: 1.1,
  top: 100,
  bottom: 0,
  r2: 0.995,
  converged: true,
  falling: true,
  flags: [],
}

const meta = {
  title: 'Plates/Dose-response plot',
  component: DoseResponsePlot,
  args: { curve },
} satisfies Meta<typeof DoseResponsePlot>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Rising: Story = {
  args: {
    curve: {
      ...curve,
      falling: false,
      points: curve.points.map((p) => ({ x: p.x, y: 100 - p.y })),
    },
  },
}
