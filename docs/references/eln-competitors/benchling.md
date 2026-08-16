# Benchling — ELN / Registry Pattern Reference

**Research snapshot:** 13 August 2026  
**Primary relevance to Sheetbase:** schema-governed structured tables, Registry concepts and granular configuration permissions.

## Product pattern

Benchling is not simply a notebook. Its Notebook is connected to Registry, Inventory, Results, Workflows and other structured applications.

The important pattern is that **structured capture in the Notebook can directly create or update governed platform objects**.

## Structured data and tables

Benchling supports structured tables in Notebook entries for domain actions including entity registration, inventory operations, result capture and lookup/reference data. Rows correspond to objects and columns are determined by table type and configured fields.

Notebook tables also support spreadsheet-style formulas including functions such as `SUM`, `AVERAGE`, `IF` and `XLOOKUP` in current documentation.

### Sheetbase lesson

A Notebook Sheet can be a first-class editor/composition over governed database objects and Datasets rather than an attached spreadsheet file.

## Schemas and Models

Benchling Registry uses schemas to define scientific entity types and fields. Schema configuration is an explicit administrative capability.

Its permission documentation distinguishes actions such as viewing/editing schema definitions and viewing/creating/registering schema objects.

### Sheetbase lesson

Separate schema authority from Record authority. Do not model permissions only as `viewer/member/admin`.

## Permissions and configuration

Benchling has layered permissions across projects/folders, Registry, individual schemas, Inventory, templates and applications/modules. Schema access policies include progressively stronger capabilities and editing a schema definition is reserved for appropriate schema administration.

## Templates

Benchling uses templates to standardise Notebook work while structured tables remain connected to Registry/Results concepts.

The useful pattern is **composition of governed structured objects inside repeatable scientific records**.

## Scale

Benchling documents bulk registration/import paths and spreadsheet imports for larger sets of entities.

### Sheetbase lesson

Excel-like UX should have database-aware bulk operations rather than forcing row-at-a-time form submission.

## What Sheetbase should copy conceptually

- schema-level configuration permissions;
- stable schemas behind Notebook tables;
- typed Record links/lookups;
- spreadsheet familiarity inside governed capture;
- database-aware bulk operations;
- auditability of schema/configuration changes.

## What Sheetbase can improve on

Avoid requiring a proliferation of domain-specific table products to get structured behaviour. Prefer a generic compositional Sheet plus typed bindings/actions so the same engine supports registration, measurements, calculated data, ad hoc scientific work and later Pipeline outputs.

## Official sources

- Permissions overview: https://help.benchling.com/hc/en-us/articles/9684210957581-Permissions-overview
- Standardize data capture with structured tables: https://help.benchling.com/hc/en-us/articles/9684258095757
- Create and manage entities with the Registry: https://help.benchling.com/hc/en-us/articles/39953982240397-Create-and-manage-entities-with-the-Registry
- Configure Inventory schemas: https://help.benchling.com/hc/en-us/articles/39947063189645-Configure-Inventory-schemas

## Caveat

Benchling is a broad platform and behaviour varies with tenant configuration/licensed modules. This note captures architectural patterns from public 2026 documentation, not an exhaustive feature inventory.
