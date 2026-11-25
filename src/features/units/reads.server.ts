import { z } from 'zod'

import { UNITS_CONVERT_TOOL } from './operations'
import { invalid, toolDef } from '#/lib/assistant-lab-tools.server'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import type { ProviderToolDef } from '#/lib/ai-providers/types'

export const unitsConvertSchema = z.strictObject({
  value: z.number().describe('The number to convert.'),
  from: z.string().min(1).max(40).describe('Its unit, such as g or µL.'),
  to: z.string().min(1).max(40).describe('The unit to convert to.'),
})

export function unitsReadDefs(): ProviderToolDef[] {
  return [
    toolDef(
      UNITS_CONVERT_TOOL,
      'Convert a number to another unit of the same kind (mass, volume, concentration, time, temperature, pressure, flow, cells per volume), as the lab stores a value typed in another unit. Fields with a unit also take "2 g" directly.',
      unitsConvertSchema,
    ),
  ]
}

export const isUnitsReadTool = (name: string): boolean =>
  name === UNITS_CONVERT_TOOL

export async function runUnitsReadTool(
  _name: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw tool input is immediately checked by unitsConvertSchema before use.
  args: unknown,
  context: LabToolContext,
): Promise<{ text: string; isError: boolean }> {
  const parsed = unitsConvertSchema.safeParse(args)

  if (!parsed.success) return { text: invalid(parsed.error), isError: true }

  try {
    const result = await context.client.rpc('convert_quantity', {
      p_value: parsed.data.value,
      p_from_unit: parsed.data.from,
      p_to_unit: parsed.data.to,
    })

    return { text: JSON.stringify(result), isError: false }
  } catch {
    return {
      text: `${parsed.data.from} can’t be converted to ${parsed.data.to}: they measure different things.`,
      isError: true,
    }
  }
}
