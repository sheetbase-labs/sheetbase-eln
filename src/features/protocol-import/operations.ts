/**
 * Bring a protocol written elsewhere in as a draft protocol of the lab's own.
 * Nothing is fetched here: the caller (a person, a token, a pipeline, or the
 * protocols.io plugin) hands over the title and steps. The assistant reaches it
 * through plugin operations that read the source and then run this, as a card.
 */
import { defineOperations, input } from '#/lib/operations/descriptor'
import type { OperationInput } from '#/lib/operations/descriptor'

const note = (
  name: string,
  type: OperationInput['type'],
  description: string,
  required = true,
  nullable = false,
): OperationInput => ({ ...input(name, type, required, nullable), description })

export const PROTOCOL_IMPORT_OPERATIONS = defineOperations([
  {
    name: 'import_protocol',
    label: 'Import a protocol',
    summary: 'Import a protocol as a draft protocol',
    description:
      'Creates a draft protocol with the steps, reagents and source line you give it, for a method written elsewhere such as a public protocol on protocols.io. Returns the protocol record and the number of steps. Sends `protocol.imported`, and `record.created` for the new protocol.',
    kind: 'write',
    scope: 'projects:write',
    inputs: [
      {
        ...input('p_workspace_id', 'uuid'),
        server: 'workspace',
        description: 'Your workspace id.',
      },
      note('p_title', 'text', 'The protocol title, up to 200 characters.'),
      note(
        'p_steps',
        'json',
        'The steps in order: `[{ "text": "Dilute the dye 1:200 in TE", "section": "Prepare" }]`. `section` is optional and starts a heading where it changes. Up to 300 steps.',
      ),
      note(
        'p_description',
        'text',
        'What the protocol is for. Blank lines start new paragraphs.',
        false,
        true,
      ),
      note(
        'p_reagents',
        'text[]',
        'Reagents and equipment, one line each, such as `Quant-iT PicoGreen (Thermo Fisher, P7589)`.',
        false,
      ),
      note(
        'p_source',
        'json',
        'Where it came from: `{ "provider": "protocols.io", "url": "https://…", "doi": "10.17504/…" }`. Written as the first line of the protocol and sent with the event.',
        false,
      ),
    ],
    result: 'json',
    pipeline: {},
    docsPage: 'protocol-import-api.md',
    events: [
      {
        name: 'protocol.imported',
        family: 'record',
        summary:
          'A protocol written elsewhere was imported as a draft protocol.',
        producer: { entityType: 'protocol_import', operation: 'create' },
        notes:
          'Payload carries `recordId`, `identifier`, `title`, `provider`, `url` and `steps`.',
      },
    ],
  },
])
