# 0025. Structured rich-text payload contract

- **Status:** accepted
- **Date:** 2026-07-20
- **Ticket:** Phase 3 correction to ELN-005

## Context

Decision 0015 defines `rich_text` as structured paragraphs with inline
formatting, but the first ELN-005 implementation stored `{ "body": "..." }`
and exposed a plain textarea. HTML would provide formatting but is not a
stable authoritative format and would require a separate sanitisation
contract. Sheetbase already versions each block payload and stores it as
JSONB, so editor state can remain inside the existing persistence boundary.

This is a single-user alpha. Maintaining both the textarea payload and the
structured payload at runtime would create an unnecessary permanent branch.

## Decision

`rich_text` payload schema version 1 has one canonical shape:

```json
{
  "doc": {
    "type": "doc",
    "content": [{ "type": "paragraph" }]
  }
}
```

`doc.content` contains `heading`, `paragraph`, `bulletList`, or `orderedList`
nodes. Heading nodes require exactly an integer `level` attribute of 2 or 3;
H1 is reserved for the record title outside document prose, while H4–H6 are
excluded to keep notebook hierarchy restrained.
Lists contain `listItem` nodes whose first child is a paragraph and whose
remaining children, when present, are nested lists. Paragraphs contain text
nodes. Text nodes may carry each of these marks at most once: `bold`,
`italic`, `link`, `subscript`, `superscript`, and inline `code`. Links permit
only root-relative, `http`, `https`, and `mailto` destinations. Ordered lists
may carry a positive integer `start` attribute. No HTML is authoritative or
stored by the editor.

Tiptap is the prose authoring engine and emits this JSON document. Unsupported
nodes, marks, attributes, extra payload fields, unsafe links, and malformed
trees fail application-boundary validation. Headings, paragraphs, and prose
lists are one coherent Tiptap document model. `heading` and generic `list`
are therefore not notebook block types. Interactive checklists, linked
records, sheets, charts, and other scientific controls remain separate blocks
because they carry behavior or domain identity beyond prose.

Read-only views render the validated tree directly as React elements. They do
not convert stored content to HTML or use raw HTML injection. The Tiptap client
uses deferred initial rendering so server output and first hydration output
remain stable.

There is no runtime reader, writer, or adapter for legacy `{ "body": string }`
payloads or standalone heading/list payloads. Alpha fixtures and API examples
move directly to the canonical shape. Existing development databases must be
reset and reseeded. The JSONB payload structure does not change, but migration
0021 narrows the durable block-type constraint so removed prose block types
cannot re-enter through lower-level API calls.

## Consequences

- Rich text has one durable representation across authoring, autosave,
  conflicts, live reconciliation, revisions, REST, and read-only rendering.
- Formatting and list structure survive reload without treating generated
  HTML as scientific content.
- Existing alpha rows using `body` are intentionally rejected and require a
  development reseed.
- Existing alpha `heading` and generic `list` rows are intentionally not
  converted at runtime; reset/reseed is the explicit transition.
- Adding another node, mark, or attribute requires an explicit payload-schema
  contract change rather than accepting arbitrary Tiptap JSON.
