# Revvity Signals Notebook — ELN Pattern Reference

**Research snapshot:** 13 August 2026  
**Primary relevance to Sheetbase:** administrator-led templates/configuration, explicit configuration roles and reusable Table templates.

## Product pattern

Signals Notebook uses a strong configuration/template layer to standardise Notebook, Experiment, Worksheet and Table behaviour. Configuration is visibly separated from ordinary authoring.

## Configuration roles

Signals Configuration documentation describes distinct administrative privileges including Configure System, Manage System Templates, Manage Groups and Manage Attributes. System template management covers objects such as Notebook, Experiment, Worksheet and Table templates.

### Sheetbase lesson

Treat configuration as a delegated product capability rather than assuming every user who can edit an experiment may alter governing structures.

## Notebook and Worksheet templates

The default Notebook template is system-controlled and editable by appropriate configuration administrators. Administrators can add fields and standardised metadata.

Worksheet templates can embed reusable Table templates.

## Tables

Signals Table templates define columns users later enter in experiments/worksheets. Official support guidance describes configuring a Table template, embedding it in a Worksheet template, entering data into predefined columns and using read-only fields.

Documentation also illustrates an important coupling: updating an embedded Table definition does not necessarily flow transparently into an already configured Worksheet template; an updated Table may need to be re-added.

### Sheetbase lesson

Separate schema definition, reusable composition/template, instantiated Dataset and presentation. Templates should reference explicit schema versions rather than hide their relationship.

## Permissions

Signals makes configuration privileges explicit and separate, with sharing privileges also applying to templates/system objects.

### Sheetbase lesson

Configuration capabilities should include distinct authority for Models/schemas, Templates, vocabularies, roles and integrations rather than one undifferentiated admin switch.

## What Sheetbase should copy conceptually

- explicit configuration workspace;
- delegated configuration roles;
- reusable Table templates;
- read-only/required field configuration;
- clear distinction between authoring and system configuration;
- awareness of outdated/versioned definitions.

## What Sheetbase can improve on

Avoid making template hierarchy the semantic schema. A Dataset Schema should evolve independently while a Notebook/Template explicitly pins or follows a schema version according to policy.

## Official sources

- User roles in Signals Configuration: https://support.revvitysignals.com/hc/en-us/articles/20797699259028-Learn-about-User-Roles-from-the-Signals-Configuration
- Default Notebook Template: https://support.revvitysignals.com/hc/en-us/articles/37320420726676-Signals-Notebook-Understanding-and-Configuring-the-Default-Notebook-Template
- Embed a Table in a Worksheet template: https://support.revvitysignals.com/hc/en-us/articles/18522529621268-Embed-a-table-in-a-Worksheet-template-from-the-Signals-Configuration
- Fill in a Table in an experiment: https://support.revvitysignals.com/hc/en-us/articles/19043944467092-Signals-Notebook-Fill-in-a-Table-of-an-experiment-in-Signals

## Caveat

Signals is a large suite and configuration varies by edition and enabled applications. These notes focus on publicly documented configuration mechanics.