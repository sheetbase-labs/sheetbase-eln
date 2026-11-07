/**
 * Sample extension: work an extension can add.
 *
 * One extension with one of each runner point, so the whole path can be tried
 * without an outside service:
 *
 * - a pipeline action (`summarise-values`) that summarises a list of numbers,
 *   run in the isolated Python runner;
 * - a read assistant tool (`dilution-volumes`) the assistant and MCP clients
 *   can call, also Python;
 * - a write assistant tool (`print-label`) that calls a signed webhook, so the
 *   person sees a card and presses a button before anything is sent. Point its
 *   address at your own service (see docs/development/build-an-extension.md);
 * - an analysis kind (`moving-average`) the analysis studio offers beside the
 *   built-in ones, run in the Python runner and charted from its declared
 *   result.
 *
 * Install it from Settings → Extensions → Add an extension → Use the sample.
 */
import type { ExtensionManifest } from '../manifest'

export const SAMPLE_TOOLS_KEY = 'sample-tools'

export const SAMPLE_TOOLS_MANIFEST = {
  id: 'sheetbase.sample-tools',
  name: 'Sample bench tools',
  version: '1.0.0',
  source: 'dev:sheetbase-sample-tools',
  compatibleWith: '*',
  capabilities: [],
  scopes: ['projects:read'],
  contributions: {
    'pipeline-actions': [
      {
        id: 'summarise-values',
        title: 'Summarise a list of numbers',
        description: 'Counts the numbers and gives their mean and range.',
        inputs: [
          {
            name: 'values',
            type: 'json',
            required: true,
            description: 'A list of numbers, such as [1.2, 1.4, 1.1].',
          },
        ],
        outputs: [
          { name: 'count', type: 'integer', required: true },
          { name: 'mean', type: 'number', required: true },
          { name: 'minimum', type: 'number', required: true },
          { name: 'maximum', type: 'number', required: true },
        ],
        runner: {
          kind: 'python',
          code: `def run(input):
    values = [float(v) for v in input["values"]]
    if not values:
        raise ValueError("Give at least one number.")
    return {
        "count": len(values),
        "mean": sum(values) / len(values),
        "minimum": min(values),
        "maximum": max(values),
    }
`,
        },
      },
    ],
    'assistant-tools': [
      {
        id: 'dilution-volumes',
        title: 'Dilution volumes',
        description:
          'Works out how much stock and diluent to mix to reach a target concentration in a final volume. Use it for any simple dilution; concentrations must be in the same unit.',
        access: 'read',
        inputs: [
          {
            name: 'stock_concentration',
            type: 'number',
            required: true,
            description: 'Concentration of the stock.',
          },
          {
            name: 'target_concentration',
            type: 'number',
            required: true,
            description: 'Concentration wanted, in the same unit.',
          },
          {
            name: 'final_volume',
            type: 'number',
            required: true,
            description: 'Final volume wanted, in any volume unit.',
          },
        ],
        runner: {
          kind: 'python',
          code: `def run(input):
    stock = float(input["stock_concentration"])
    target = float(input["target_concentration"])
    final = float(input["final_volume"])
    if stock <= 0 or target <= 0 or final <= 0:
        raise ValueError("Concentrations and volume must be above zero.")
    if target > stock:
        raise ValueError("The target is stronger than the stock; it cannot be reached by diluting.")
    stock_volume = final * target / stock
    return {
        "stock_volume": stock_volume,
        "diluent_volume": final - stock_volume,
        "dilution_factor": stock / target,
    }
`,
        },
      },
      {
        id: 'print-label',
        title: 'Print a sample label',
        description:
          'Sends a label for a sample to the lab label printer. Use it only when the person asks for a label.',
        access: 'write',
        inputs: [
          {
            name: 'sample_name',
            type: 'text',
            required: true,
            description: 'Name to print on the label.',
          },
          {
            name: 'copies',
            type: 'integer',
            required: false,
            description: 'How many labels to print.',
          },
        ],
        runner: { kind: 'webhook', url: 'https://labels.example.org/print' },
      },
    ],
    'analysis-kinds': [
      {
        id: 'moving-average',
        title: 'Moving average',
        description:
          'Smooths a measurement over neighbouring points (a three-point average).',
        inputs: [
          { name: 'x', label: 'Along (x)', type: 'number', required: true },
          { name: 'y', label: 'Measured (y)', type: 'number', required: true },
        ],
        runner: {
          kind: 'python',
          code: `def run(data):
    data = data.dropna(subset=["x", "y"]).sort_values("x")
    data["smoothed"] = data["y"].rolling(3, center=True, min_periods=1).mean()
    return data[["x", "y", "smoothed"]]
`,
        },
        result: {
          columns: [
            { name: 'x', type: 'number' },
            { name: 'y', type: 'number' },
            { name: 'smoothed', type: 'number' },
          ],
          chart: { type: 'line', x: 'x', y: 'smoothed' },
        },
      },
    ],
  },
} as const satisfies Pick<
  ExtensionManifest,
  'id' | 'name' | 'version' | 'source' | 'capabilities' | 'scopes'
> & { compatibleWith: string; contributions: Record<string, unknown> }
