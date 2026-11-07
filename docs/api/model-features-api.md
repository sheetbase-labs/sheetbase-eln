# Model features API

A feature is an optional thing a record model can do. A lab switches each one on
for the models that need it, from a model's **Features** button in the app or
with one call. This replaces the separate tick-boxes and lab-wide switches that
registries, incident logs, result limits, legal holds and retention used to have.

| Feature key     | What it adds to records of the model                                                                         | Settings it keeps                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `campaigns`     | Records can be optimisation campaigns (see [campaigns-api.md](campaigns-api.md)).                            | none                                                      |
| `registry`      | Records are registered entries: a duplicate check, lineage, and (with a structure field) compounds and lots. | `keyFields`, `sequenceField`, `structureField`, `lotKind` |
| `incident_log`  | Records are listed together on the Incidents page and send `incident.reported`.                              | none                                                      |
| `result_limits` | Number fields can carry limits; `record_spec_results` judges each value pass, alert or fail.                 | none (the limits are in `field_spec_limits`)              |
| `legal_hold`    | Records can be frozen by a legal hold.                                                                       | none                                                      |
| `retention`     | A retention rule applies to the model's records; `retention_due` and `apply_retention` act on them.          | none (the rules are in `retention_rules`)                 |

## Read

```
GET /api/db/model_capabilities?select=model_key,capability,settings
```

One row per model and feature. A model that has no row for a feature does not have it.

## Switch a feature on or off

```
POST /api/db/rpc/set_model_capability
{ "p_model_key": "cell_line", "p_capability": "registry", "p_enabled": true,
  "p_settings": { "keyFields": ["name", "species"], "sequenceField": null,
                  "structureField": null, "lotKind": null } }
```

Needs permission to edit models. Switching a feature off removes its settings.
Switching `registry` on without settings gives a registry that only flags entries
with the same name; settings are checked against the model's active fields (at
most four duplicate-check fields; a lot model needs a structure field).
`set_model_registry` and `set_model_chemistry` still work and write the same
settings.

Sends `model.feature.enabled` or `model.feature.disabled` to webhooks.

## What a feature does not change

- A legal hold keeps protecting its records even if the `legal_hold` feature is
  later switched off: the database refuses to archive or delete a held record
  whatever the features say.
- Limits in `field_spec_limits` and rules in `retention_rules` are kept when a
  feature is switched off. They show no verdicts and archive nothing until it is
  switched on again.

## Moved from the old switches

Earlier versions had `is_registry` and the `registry_*` columns on
`record_models`, the `model_incident_logs` table, and the lab-wide
`spec_limits_enabled` and `retention_enabled` settings with
`set_spec_limits_enabled`, `set_retention_enabled` and `set_model_incident_log`.
They are gone. Every old value was carried across when the lab was upgraded: a
registry model keeps its fields as the feature's settings, an incident log
becomes the `incident_log` feature, and a lab-wide switch that was on became the
feature on every model the lab had.
