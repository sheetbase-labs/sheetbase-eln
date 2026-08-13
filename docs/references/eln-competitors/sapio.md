# Sapio Sciences — ELN / Lab Informatics Pattern Reference

**Research snapshot:** 13 August 2026  
**Primary relevance to Sheetbase:** highly configurable data foundation, no/low-code workflows, role-based configuration and agentic platform configuration.

## Product pattern

Sapio is one of the most directly relevant competitors to the proposed Sheetbase direction because it positions ELN, LIMS and scientific data management on a shared configurable platform.

Its core message is not simply digital experiment writing; it is configuring scientific data and workflows without rebuilding the system.

## Data/Model configurability

Sapio markets a configurable data foundation spanning ELN and LIMS. Public material describes no/low-code configuration through workflow designers, rules, configurable UI, APIs, webhooks and AI-assisted generation/configuration.

### Sheetbase lesson

Model configuration should be a core platform surface rather than an admin afterthought. Sheetbase should additionally keep the underlying schema contracts explicit enough that sophisticated users can reason about API types, migrations and Pipeline dependencies.

## Workflow configuration

Sapio strongly emphasises no/low-code workflow construction and scientific/business rules.

### Sheetbase lesson

This validates the long-term configurable Pipeline direction, but reinforces separating data model, Pipeline definition, execution and visual builder. Do not start with boxes and arrows.

## Role-aware configuration

Sapio product/customer material describes role-based configuration and permissions, including configuring functionality for different roles and controlling access across data/functions.

### Sheetbase lesson

Role-specific configuration should affect both what data/actions a user can access and what configuration surfaces/actions they can use. This should be policy-driven rather than hard-coded page variants.

## AI / Elain

Sapio's Elain is positioned as an AI co-scientist assisting experiment design, SOP interpretation, analysis/visualisation, data interaction and platform configuration/code generation.

### Sheetbase lesson

The future Sheetbase agent should work with schemas, Datasets and Pipelines rather than merely writing Notebook prose, subject to normal validation, permissions and approvals.

## Scale

Sapio emphasises enterprise-scale lab workflows and has publicly discussed high-scale sample-management use cases.

### Sheetbase lesson

Configurability cannot depend on loading all metadata/data into a browser or executing all logic client-side.

## What Sheetbase should copy conceptually

- configurable data foundation as a product pillar;
- data + workflow configuration in one coherent platform;
- role-based functional configuration;
- rules, APIs and webhooks as automation hooks;
- AI capable of proposing/configuring scientific workflows.

## What Sheetbase can improve on

Make spreadsheet interaction more central and transparent. Sheetbase can combine Sapio-like platform configurability with a genuinely strong Excel-like grid whose columns visibly map to typed Models, Datasets and APIs.

## Official sources

- Sapio platform overview: https://www.sapiosciences.com/
- Sapio ELN: https://www.sapiosciences.com/products/electronic-lab-notebook/
- Role-based permissions: https://www.sapiosciences.com/blog/securing-innovations-role-based-permissions-and-encrypted-data-handling/
- PTC Therapeutics case study: https://www.sapiosciences.com/resource/case-study-ptc-therapeutics/
- Biorepository / role-based access and scale: https://www.sapiosciences.com/news/sapio-sciences-introduces-biorepository-management-solution-in-sapio-release-25-4/

## Caveat

Sapio's public material is more product/marketing-oriented than some competitors' support documentation. Exact mechanics should be verified in technical documentation or a product demonstration before being treated as implementation specifications.