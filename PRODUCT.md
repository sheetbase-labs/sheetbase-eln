# Product

## Register

product

Sheetbase is primarily an application surface. Design serves scientific work: recording, structuring, analysing, reviewing and retrieving experimental information. Marketing pages may use the brand register separately, but the default for this repository is product.

## Users

Sheetbase is for scientists and technical teams working in life-science research and development. The initial context is biotech, including cell and gene therapy, but the product must remain scientifically neutral enough to support other disciplines.

Primary users include:

- laboratory scientists and research associates recording experimental work;
- assay and analytical scientists working with tables, plots and instrument outputs;
- project and study leads coordinating related experiments, protocols and datasets;
- reviewers and quality personnel checking completeness, traceability and approvals;
- laboratory operations teams managing samples, reagents, instruments and storage;
- software and data teams configuring integrations, permissions and structured data models.

Users often work for long periods on desktop screens, move between dense records, and need to understand state quickly. They may be wearing gloves, using shared laboratory computers, or reviewing work under time pressure. Accuracy, continuity and legibility matter more than novelty.

## Product Purpose

Sheetbase is a flexible electronic laboratory notebook and scientific data workspace. It combines a document-first notebook with linked structured records, tables, advanced graphing, files, review workflows and traceable scientific context.

The core hierarchy is:

Workspace → Project → Folder → Notebook or Record → Section or Block

Experiments are deliberately lightweight records. Their content is assembled from free-form notebook blocks rather than forced into one rigid experiment schema. Structured objects such as samples, protocols, datasets, analyses, figures, reports, instruments and reagents can be linked into the notebook without turning the notebook into a database form.

The product succeeds when a scientist can:

1. find the correct project, folder or record without losing context;
2. capture work naturally using text, tables, charts, files and linked records;
3. move from raw data to analysis and publication-quality figures without leaving the product;
4. understand provenance, status, ownership and relationships at a glance;
5. submit work for review, resolve comments, sign and lock records when required;
6. return months later and reconstruct what happened without relying on personal memory.

Sheetbase must support regulated workflows, including revision history, audit trails, review, electronic signatures and record locking. The interface must never claim that a record or workspace is compliant merely because a feature is present; compliance depends on configuration, process and validated use.

## Brand Personality

Precise, calm and capable.

Sheetbase should feel like a carefully designed scientific instrument: quiet while idle, exact when operated, and clear about state. It is premium without being luxurious, technical without being cold, and modern without chasing trends.

The voice is concise, direct and professional. Labels use familiar laboratory and product language. Explanations are specific and practical. Avoid hype, jokes in critical workflows, and anthropomorphic AI language.

Three-word personality: precise, composed, intelligent.

## Anti-references

Sheetbase must avoid:

- generic AI-product styling: purple gradients, neon glows, glassmorphism, floating orbs and decorative grid backgrounds;
- oversized landing-page headlines, sparse sections and excessive unused space inside product screens;
- dashboard-by-default layouts where every piece of information becomes an isolated metric card;
- nested cards, heavy shadows, thick borders and excessive rounded containers;
- a Notion clone with scientific icons added afterwards;
- a spreadsheet clone where every workflow is reduced to cells and tabs;
- consumer productivity styling, gamification, streaks, celebratory confetti or playful microcopy in regulated workflows;
- faux-scientific decoration such as random molecules, DNA strands, beakers or circuit motifs without functional meaning;
- discipline-specific assumptions embedded in the global navigation or component system;
- compliance theatre: shields, locks and green “compliant” badges without a real underlying state;
- dense enterprise software that exposes every capability at once and makes routine work feel administrative;
- excessive colour. Colour communicates action, state, category or data series; it is not surface decoration.

Named references are directional, not templates to copy:

- Attio for calm density, record inspectors and relational navigation;
- Linear for keyboard fluency, hierarchy and restrained interaction design;
- Arc and modern developer tools for crisp application chrome;
- well-designed scientific instruments for state clarity and trustworthy controls;
- high-quality architectural drawings for ordered detail and disciplined information hierarchy.

## Design Principles

1. **The notebook is the centre of gravity.** Most scientific work begins as a document. Structured records support it; they do not replace it.
2. **Structure without rigidity.** Free-form capture must coexist with reusable blocks, linked objects, controlled states and validation.
3. **Dense, never cramped.** Show enough information to work effectively, while using hierarchy, alignment and progressive disclosure to keep it calm.
4. **Context stays visible.** Project, record, status, ownership, relationships and review state should remain understandable without navigating away.
5. **One coherent system.** Tables, charts, records, files, comments and approvals must feel like parts of one product rather than embedded third-party tools.
6. **Complexity is earned.** Basic actions are obvious. Advanced graphing, formulas, lineage and compliance controls appear when relevant.
7. **Scientific meaning beats visual novelty.** Components encode real domain concepts such as sample identity, replicate, batch, review state and provenance.
8. **Traceability is a first-class experience.** History, lineage and audit information must be readable, not merely stored.
9. **Configuration over special cases.** The product can support biotech conventions without making them permanent global assumptions.
10. **AI is assistive, not authoritative.** AI-generated summaries, suggestions and transformations must be distinguishable, reviewable and attributable.

## Product Boundaries

Sheetbase is not intended to be a full manufacturing execution system or a universal LIMS in its first form. It may connect to those systems and represent linked records, but its defining strength is the combination of notebook authoring, scientific data work and traceable collaboration.

The design system must therefore optimise first for:

- project and folder navigation;
- notebook authoring and block composition;
- tables and record relationships;
- graphing and analysis;
- inspectors and contextual side panels;
- review, approval and audit workflows;
- search and retrieval.

## Accessibility & Inclusion

Baseline: WCAG 2.2 AA for all product surfaces.

- All functionality must be keyboard accessible with visible, consistent focus states.
- Status is never communicated by colour alone; use text, iconography or shape as well.
- Charts require accessible labels, legends, tabular alternatives and non-colour differentiation where practical.
- Tables must preserve header relationships and support screen-reader navigation.
- Motion must respect `prefers-reduced-motion` and never be required to understand state.
- Touch targets remain usable on tablets and shared laboratory terminals.
- The product must tolerate zoom, long scientific names, high-precision values, different units and localisation.
- Destructive, signing and locking actions require explicit confirmation and unambiguous consequences.
