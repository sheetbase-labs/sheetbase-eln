/**
 * AI-05 — one domain-understanding manifest for MCP, agent skills and the
 * in-app assistant.
 *
 * The same text must teach a coding agent, a hosted MCP client and the
 * product assistant, or the three descriptions drift. This module is the
 * source of truth; `.agents/skills/sheetbase-domain/SKILL.md` and
 * `.agents/skills/sheetbase-mcp/SKILL.md` point at it, and the MCP server
 * serves these resources and prompts verbatim.
 */

export interface DomainResource {
  uri: string
  name: string
  title: string
  description: string
  mimeType: 'text/markdown'
  text: string
}

export interface DomainPromptArgument {
  name: string
  description: string
  required: boolean
}

export interface DomainPrompt {
  name: string
  title: string
  description: string
  arguments: DomainPromptArgument[]
  build: (args: Record<string, string | undefined>) => string
}

export const MCP_SERVER_INSTRUCTIONS = [
  'Sheetbase is a scientific electronic lab notebook. Use the canonical read tools to ground every claim in a stable UUID.',
  'Draft and mutate tools only create a proposal through propose_agent_operation; they never write directly.',
  'Signing, approval, submission, publication and execution belong to a human session and are deliberately unavailable to you.',
  'Cite the object id and version pin you used. If a read returns nothing, say so; never infer a hidden object.',
].join(' ')

const CORE_MODEL = `# Sheetbase core model

Sheetbase combines a notebook with structured scientific data. The durable
objects are:

- **Project** — the container for a body of work. Stable UUID.
- **Record** — a typed scientific record (sample, reagent, instrument, and so
  on). Its type is a **Model**; its fields are **Model Field Definitions**.
  Records have a stable identifier independent of their display name.
- **Notebook** — free-form scientific narrative made of typed **blocks**.
  A notebook belongs to an experiment and can link records, datasets, sheets,
  analyses, files and comments.
- **Dataset** — a typed table. Its columns are a **Dataset Schema Version**;
  its rows are values. A **Dataset Version** is an immutable snapshot.
- **Sheet** — a spreadsheet-like composition. A **Sheet Definition** owns the
  layout and formulas; a **Sheet Instance** is one saved composition. Values
  written back to a Model become **Records**.
- **Analysis** — a saved analysis definition over a Dataset Version, producing
  charts and statistics. A frozen analysis pins the version and provenance it
  used.
- **Revision / evidence** — a submitted notebook revision is frozen evidence.
  Signatures bind a person to an exact revision, not to a mutable page.

Stable UUIDs are identity. Display names, folder placement and row numbers are
not. Never resolve an object by name when a UUID is available.

Live state and pinned state are different. A live Dataset read reflects the
current rows; a Dataset Version read reflects an immutable snapshot. State
which one you used. Never mix the two in one claim.`

const WORKFLOW = `# Scientific workflow and evidence

The normal sequence is:

1. Create or open an experiment.
2. Capture work in a notebook: text, tables, plates, files, linked records.
3. Put structured measurements in a Sheet or Dataset, with a schema that
   names units and types.
4. Save an analysis against a pinned Dataset Version.
5. Review the notebook, resolve readiness findings, and submit a revision.
6. An authorised person signs the frozen revision.

Important boundaries:

- An **edit** changes a working draft. A **submission** freezes a revision.
  A **signature** attests to that frozen revision. These are different acts.
- A correction after signature is an **amendment**, not a silent edit.
- The audit trail records who changed what, when, and from which client.
- AI output is never a signature, approval, submission or authoritative
  scientific result. It is a draft or an explanation a person must review.

When asked to "finish" or "submit" work, explain the remaining readiness
findings and stop. Do not claim the work is signed or approved.`

const DATA_AND_ANALYSIS = `# Datasets, sheets and analysis

**Dataset rows.** Read live rows with sheetbase.dataset_rows.query; read an
immutable snapshot with sheetbase.dataset_version_rows.query. Both are bounded
windows: ask for a limit and page with an offset. Never assume the first page
is the whole population.

**Schemas.** A Dataset Schema Version defines column identity, type and units.
Changing a schema is a governed draft. Units are semantic: do not relabel a
number by guessing its unit. If the unit is missing, say so.

**Sheets.** A Sheet Definition holds layout and formulas; a Sheet Instance is
one composition. Writing a row back to a Model creates a Record through the
canonical operation. A sheet cell is not a database value until that write
happens.

**Analysis.** An analysis definition names its source Dataset Version, the
transform, and the encodings. A frozen analysis keeps its source pin and
provenance so the figure can be reconstructed later. When citing an analysis,
cite the analysis id and the pinned Dataset Version id.

**Statistics.** Report n, the summary statistic and the unit you actually
read. Do not infer significance, causality or a biological conclusion from a
descriptive summary.`

const PERMISSIONS = `# Permissions, credentials and agents

PostgreSQL row-level security is the authority. The UI hiding a control is not
a permission boundary. A read that returns nothing may mean the object does
not exist **or** that the caller cannot see it; in both cases report "not
available" rather than guessing.

External clients use scoped credentials:

- personal tokens act as their creating member and inherit member RLS;
- service credentials act as the workspace service identity;
- every token carries an explicit scope list (for example datasets:read,
  sheets:read, agent_operations:write).

Agent operations have one bounded path:

1. Discover tools with tools/list.
2. Read with the canonical read tools.
3. Propose a draft or mutation through propose_agent_operation.
4. A human approves or executes consequential work in the product.

There is no private database access, no arbitrary RPC, no UI automation and no
agent signing. Human-only operations are deliberately absent from the
catalogue.`

const ASSISTANT_RULES = `# Assistant output rules

- Ground every claim in a cited Sheetbase object or rule.
- Use the stable id, not a display label, in a citation.
- Distinguish **live** from **pinned** evidence.
- Mark uncertainty explicitly. "The dataset has no unit column" is better than
  inventing "mg/mL".
- Never claim to have written, signed, approved, submitted or executed
  anything. Offer a draft the person can review.
- Keep the answer short enough to check. A useful answer names the object, the
  value and the source.
- Do not reproduce secrets, tokens, session ids or full file contents.`

export const DOMAIN_RESOURCES: DomainResource[] = [
  {
    uri: 'sheetbase://domain/core-model',
    name: 'core-model',
    title: 'Sheetbase core model',
    description:
      'Projects, records, notebooks, datasets, sheets, analyses and the identity rules that connect them.',
    mimeType: 'text/markdown',
    text: CORE_MODEL,
  },
  {
    uri: 'sheetbase://domain/scientific-workflow',
    name: 'scientific-workflow',
    title: 'Scientific workflow and evidence',
    description:
      'Draft → review → submit → sign, with the evidence and amendment boundaries.',
    mimeType: 'text/markdown',
    text: WORKFLOW,
  },
  {
    uri: 'sheetbase://domain/data-and-analysis',
    name: 'data-and-analysis',
    title: 'Datasets, sheets and analysis',
    description:
      'Live rows versus pinned snapshots, schema and units, sheet write-back and analysis provenance.',
    mimeType: 'text/markdown',
    text: DATA_AND_ANALYSIS,
  },
  {
    uri: 'sheetbase://domain/permissions',
    name: 'permissions',
    title: 'Permissions, credentials and agents',
    description:
      'RLS, scoped credentials, the bounded agent operation path and human-only acts.',
    mimeType: 'text/markdown',
    text: PERMISSIONS,
  },
  {
    uri: 'sheetbase://domain/assistant-rules',
    name: 'assistant-rules',
    title: 'Assistant output rules',
    description:
      'Grounding, citation, uncertainty and no-hidden-write rules for any model answer.',
    mimeType: 'text/markdown',
    text: ASSISTANT_RULES,
  },
]

function requireArgument(
  args: Record<string, string | undefined>,
  name: string,
): string {
  const value = args[name]?.trim()
  if (!value) throw new Error(`Missing required prompt argument: ${name}`)
  return value
}

export const DOMAIN_PROMPTS: DomainPrompt[] = [
  {
    name: 'sheetbase.explain_object',
    title: 'Explain a Sheetbase object',
    description:
      'Explain the current state of one object from canonical reads, with citations and explicit uncertainty.',
    arguments: [
      {
        name: 'objectKind',
        description: 'One of record, notebook, sheet, dataset, analysis.',
        required: true,
      },
      {
        name: 'objectId',
        description: 'Canonical UUID of the object.',
        required: true,
      },
    ],
    build: (args) =>
      [
        `Explain the ${requireArgument(args, 'objectKind')} with id ${requireArgument(args, 'objectId')}.`,
        'Read it with the canonical tools first. State what is live and what is pinned.',
        'Name the fields, units, version and review state you actually observed.',
        'If a value is missing or unreadable, say so. Do not infer it.',
        'Finish with the sources you used, by stable id.',
      ].join('\n'),
  },
  {
    name: 'sheetbase.summarise_notebook',
    title: 'Summarise a notebook',
    description:
      'Summarise a notebook for review without changing it or claiming it is complete.',
    arguments: [
      {
        name: 'recordId',
        description: 'Canonical UUID of the notebook/record.',
        required: true,
      },
    ],
    build: (args) =>
      [
        `Summarise the notebook ${requireArgument(args, 'recordId')} for a reviewer.`,
        'Cover: purpose, work performed, measurements with units, linked data and open questions.',
        'Separate observed facts from your summary. Cite the blocks, records and Dataset Versions you read.',
        'List readiness gaps you can see. Do not claim the notebook is ready to submit or signed.',
      ].join('\n'),
  },
  {
    name: 'sheetbase.propose_dataset_schema',
    title: 'Propose a dataset schema',
    description:
      'Propose a Dataset Schema draft from an existing table or stated intent. Draft only.',
    arguments: [
      {
        name: 'datasetId',
        description:
          'Canonical UUID of an existing Dataset to infer from, or the word "new".',
        required: true,
      },
      {
        name: 'intent',
        description: 'What the dataset needs to capture.',
        required: true,
      },
    ],
    build: (args) =>
      [
        `Draft a Dataset Schema for: ${requireArgument(args, 'intent')}.`,
        `Source dataset: ${requireArgument(args, 'datasetId')}.`,
        'Read the source schema and a bounded sample of rows first if one exists.',
        'Propose stable keys, types, units and required/optional fields.',
        'Flag every unit you had to infer. Do not silently relabel a number.',
        'Submit the result through sheetbase.dataset_schema.draft only. It is a proposal for a person to review.',
      ].join('\n'),
  },
  {
    name: 'sheetbase.review_submission',
    title: 'Review a submission',
    description:
      'Check a notebook revision for review readiness. Never sign or submit.',
    arguments: [
      {
        name: 'recordId',
        description: 'Canonical UUID of the notebook/record.',
        required: true,
      },
    ],
    build: (args) =>
      [
        `Review notebook ${requireArgument(args, 'recordId')} for submission readiness.`,
        'Report missing required sections, unresolved validation issues, uncited analyses and unsigned evidence.',
        'Separate blocking findings from suggestions.',
        'End with: "A person must review and sign; this is not a signature or approval."',
      ].join('\n'),
  },
  {
    name: 'sheetbase.find_related_work',
    title: 'Find related work',
    description:
      'Search permitted workspace records and return cited results, including archived state.',
    arguments: [
      {
        name: 'query',
        description: 'What to search for.',
        required: true,
      },
    ],
    build: (args) =>
      [
        `Find related work for: ${requireArgument(args, 'query')}.`,
        'Use sheetbase.search with a bounded limit. Report the query, the result count and each result with its stable id and archived state.',
        'Do not claim the list is exhaustive: search is permission-filtered and may be incomplete.',
      ].join('\n'),
  },
]

export function findDomainResource(uri: string): DomainResource | null {
  return DOMAIN_RESOURCES.find((resource) => resource.uri === uri) ?? null
}

export function findDomainPrompt(name: string): DomainPrompt | null {
  return DOMAIN_PROMPTS.find((prompt) => prompt.name === name) ?? null
}
