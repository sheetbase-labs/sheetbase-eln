# Pipeline steps and code

Building blocks for Pipelines: the ordered step list, step kinds, code, and the marker for temporary data.

- `.steps` is an ordered list of steps joined by a dashed line. Each item has a number (`.n`), a name, a `.sub` line with what it reads and returns, and a `.kind` label (`SQL`, `Python`, `ELN`, `Notify`). The current step uses `.on`. On a run page, colour the number by result: success wash for done, danger wash for failed, warning wash for waiting, dashed for not started.
- `.code` shows SQL, Python and logs with line numbers. Use `.kw` for keywords, `.str` for strings, `.cm` for comments and `.ref` for run tables such as `previous`. Add `.wrap` for logs so long lines wrap.
- `.tmp` marks anything that only exists for the length of a run (pinned inputs copied into SQL tables, step results, files). Always say when it is deleted.
- Say what a run keeps in plain words: "Keep nothing" is the default. ELN actions that change records are proposals a named person accepts.
