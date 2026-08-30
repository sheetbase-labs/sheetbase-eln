# ELN and Scientific Informatics Competitor References

> **Research snapshot:** 13 August 2026  
> **Purpose:** Product/architecture reference material for Sheetbase.  
> **Status:** Research, not normative specification. Current Sheetbase requirements live in `docs/core/` and `ROADMAP.md`.

These notes capture the competitor research that informed the Core Data Workspace reset. They exist so future contributors and agents can understand **why** some of the current product decisions were made instead of rediscovering the market from scratch.

## Products reviewed

- [Benchling](./benchling.md)
- [Dotmatics](./dotmatics.md)
- [Revvity Signals Notebook](./signals-notebook.md)
- [SciNote](./scinote.md)
- [Labguru](./labguru.md)
- [Sapio Sciences](./sapio.md)

See [cross-product patterns](./competitor-patterns.md) for the main conclusions.

## Research focus

The review deliberately concentrated on the questions most relevant to Sheetbase:

- how structured scientific data is captured;
- whether spreadsheet/table interaction is central or secondary;
- how schemas, registries, collections and data models are configured;
- how templates relate to schemas;
- how ordinary data-entry permissions differ from configuration permissions;
- how workflows and transformations are represented;
- how APIs and code-based automation fit into the product;
- current movement toward agentic configuration/manipulation;
- patterns relevant to scale and information density.

This is **not** a procurement ranking and does not attempt to catalogue every module of every product.

## Important cross-product findings

1. **Structured capture is increasingly central.** Mature ELNs are moving beyond document storage toward structured scientific records that power search, analytics, automation and AI.
2. **Excel familiarity remains valuable.** Even strongly structured systems retain spreadsheet/table interaction because it is efficient and familiar for scientists.
3. **Configuration authority is normally separated from ordinary scientific editing.** Benchling and Signals are particularly clear examples.
4. **Templates are the common bridge between flexibility and standardisation.** They are useful, but products can become rigid when template, schema and presentation are too tightly coupled.
5. **AI is moving from summarisation toward configuration and execution.** Dotmatics, Sapio and Labguru all provide useful signals for the future Sheetbase Pipeline/agent direction.
6. **Sheetbase has an opportunity to make the layers more explicit than competitors:** schema/model = meaning; Dataset = durable rectangular data; Sheet/View = composition/presentation; Notebook = context; Pipeline = transformation.

## Source policy

The notes use official vendor product pages and official vendor support/knowledge-base documentation available on 13 August 2026. URLs are included in each product file.

Vendor documentation changes. Treat these files as a dated research snapshot. If a future architectural decision depends on a competitor's exact current behaviour, verify the source again before relying on it.

## Relationship to the Core programme

The research helped support several decisions now captured normatively in `docs/core/`:

- compositional Excel-like Sheets over governed data;
- user-extensible Models with protected platform fields;
- a shared semantic field kernel for Models and Datasets;
- separate schema/configuration capabilities;
- explicit Templates rather than hidden schema copying;
- versioned typed Pipelines after the Model/Dataset/Sheet substrate is stable;
- agents authoring/reviewing governed definitions rather than bypassing normal data contracts.
