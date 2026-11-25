/**
 * Unit conversion on the API, the SDKs, MCP (`sheetbase.lab.act`), the
 * assistant and pipeline actions. Writes need nothing of their own: a value
 * typed as "2 g" or `{ "value": 2, "unit": "g" }` is converted wherever a
 * number is written to a field with a unit.
 */
import { defineOperations, input } from '#/lib/operations/descriptor'
import type { OperationInput } from '#/lib/operations/descriptor'

export const UNITS_CONVERT_TOOL = 'sheetbase.units.convert'

const note = (
  name: string,
  type: OperationInput['type'],
  description: string,
): OperationInput => ({ ...input(name, type, true), description })

export const UNITS_OPERATIONS = defineOperations([
  {
    name: 'convert_quantity',
    label: 'Convert a value to another unit',
    summary: 'A number in another unit of the same kind',
    description:
      'Returns `{ value, unit, from: { value, unit }, dimension }`: the value in `p_to_unit`, rounded to 12 significant figures, as the database stores a value typed in another unit. Converts only between units of the same kind (mass, volume, concentration, time, temperature, pressure …) from the built-in unit table (`lab_units`); a "×10⁶" in front of a unit scales it. Refuses units of different kinds. Changes nothing.',
    kind: 'read',
    scope: 'lab:read',
    inputs: [
      note('p_value', 'num', 'The number to convert.'),
      note('p_from_unit', 'text', 'Its unit, such as `g`, `µL` or `°C`.'),
      note('p_to_unit', 'text', 'The unit to convert to, such as `mg`.'),
    ],
    result: 'json',
    assistant: {
      tool: UNITS_CONVERT_TOOL,
      presentation: 'answer',
      vocabulary: 'read',
    },
    pipeline: {},
    docsPage: 'units-api.md',
  },
])
