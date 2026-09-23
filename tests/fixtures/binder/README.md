# Binder consistency fixtures

Copied verbatim from `quesadx/pl-lg` `tests/eval/negative/` (pinned commit
`fd2dc7af10e759efed773934dba6f3c02e592014`) so the LSP binder can be proven to
report `E500`/`E506` with the same code, message and hint as the core evaluator.
Spans are asserted in `tests/unit/binder.test.ts`.
