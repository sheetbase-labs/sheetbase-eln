# Publishing to a repository and ontology terms

## What it is for

Publish an experiment or a dataset version with a DOI so others can cite it,
packaged as an RO-Crate: the data as CSV, a description of every column (with
unit and ontology terms), the licence and authors. A dataset version that a
pipeline run produced also carries a Workflow Run Crate (the pipeline, the run,
its parameters and its input versions).

Supported repositories: Zenodo, Figshare, InvenioRDM instances and Dataverse
installations. The clients follow each service's documented API and are tested
against stand-ins, so try a sandbox first (for example sandbox.zenodo.org).

## Setting it up

Settings > Open data > Publishing repositories (integrations access). Add the
repository's address, a default licence and an access token created in that
repository's account settings. The token is stored sealed and never shown again.

It is **outbound and opt-in**: nothing is sent until someone chooses Publish.
The server needs to reach the repository's address.

## Publishing

On an experiment or on a dataset version, **Publish**: choose a repository,
title and licence. The server sends a **draft**, which reserves a DOI; the draft
and its package appear in the dialog. Open the draft at the repository if you
want to look. **Publish with DOI** makes it public. That cannot be undone (the
repository keeps the record and DOI even if you delete things here), so it is a
separate confirmation by a person, never done by a pipeline, the API or the
assistant. A failed send is retried with growing gaps and given up after five
tries; **Try again** queues it again.

## Ontology terms

Settings > Open data > Ontology lookup, off by default. When on, the term
search on a model field sends what you type to the EBI Ontology Lookup Service
(OBI, ChEBI, CL, Uberon, NCBITaxon and UO by default). Linked terms are written
into the crate's column descriptions. Existing links stay visible when lookup is
turned off.
