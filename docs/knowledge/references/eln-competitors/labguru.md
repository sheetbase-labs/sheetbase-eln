# Labguru — ELN / Lab Management Pattern Reference

**Research snapshot:** 13 August 2026  
**Primary relevance to Sheetbase:** configurable inventory structures, custom roles, REST/Python integration, coded workflow automation and AI-assisted workflow creation.

## Product pattern

Labguru combines ELN, inventory/storage, equipment and workflow automation. Its most relevant pattern for Sheetbase is the pragmatic bridge between ordinary lab-management UX and a programmable automation layer.

## Configurable Models / collections

Labguru supports inventory collections with default and custom fields. Public documentation shows administrators can customise collections, some default fields are locked/required, custom fields can be required, collections can have parent/derived relationships, and stock objects can have additional custom fields/types.

This resembles Sheetbase's emerging pattern of **locked base fields plus workspace fields**.

### Sheetbase lesson

The pattern is established and sensible. Sheetbase can make it universal and schema-versioned rather than confined to individual modules.

## Inventory item versus stock

Labguru explicitly separates scientific inventory item identity/metadata from physical stock instances/location/condition.

### Sheetbase lesson

Keep semantic object identity separate from physical inventory instances. A Reagent Record and Stock/Aliquot Record should not be collapsed merely because one registry displays them together.

## Roles

Labguru allows account owners/admins to create roles and assign privileges.

### Sheetbase lesson

Organisations need configurable capability bundles beyond fixed admin/member/viewer roles.

## Datasets and API

Labguru exposes Datasets as structured aggregations linked to samples, with Excel export and API access. Its REST API provides broad platform CRUD and Python/R wrappers are documented.

### Sheetbase lesson

The same scientific objects should be approachable from UI and programmatic APIs. This supports retaining PostgREST/API addressability as a core Sheetbase principle.

## Workflow Editor

Labguru's Workflow Editor supports process automation and data analysis. Official documentation describes API-driven steps, calculations, Python code/scripting, external triggers, instrument-data ingestion and actions that update ELN/inventory data.

This is directly relevant to the future Sheetbase Pipeline model.

## Automation Agent

Current Labguru documentation describes an Automation Agent that generates workflows from natural-language descriptions. The interaction pattern is roughly: describe trigger/actions → inspect generated plan → refine → approve/create → workflow remains inactive until explicitly activated.

### Sheetbase lesson

This is close to the preferred future pattern: **agent authors a governed definition; human reviews it; the normal execution system runs it**.

## What Sheetbase should copy conceptually

- locked core fields + admin-defined extension fields;
- item versus physical-stock separation;
- configurable account roles;
- strong API surface;
- Python/code inside workflow automation;
- external-trigger/instrument ingestion;
- AI-generated workflow definitions requiring review.

## What Sheetbase can improve on

Make Pipeline a native platform primitive rather than a separate automation add-on, with typed input/output schemas so provenance follows automatically.

## Official sources

- Customize your Collection: https://help.labguru.com/en/articles/5376242-how-to-customize-your-collection
- Inventory Items and Stocks: https://help.labguru.com/en/articles/1492345-inventory-items-and-stocks
- Account Roles and Privileges: https://help.labguru.com/en/articles/5534330-account-roles-and-privileges
- API Introduction and Overview: https://help.labguru.com/en/articles/6149483-api-introduction-and-overview
- Computational Methods and Tools: https://help.labguru.com/en/articles/3599993-computational-methods-and-tools-in-labguru
- Introducing the Automation Agent: https://help.labguru.com/en/articles/13225365-introducing-the-automation-agent

## Caveat

Some workflow capabilities are add-ons and permissions differ by module. This note extracts architectural patterns rather than assuming every Labguru tenant exposes every feature.
