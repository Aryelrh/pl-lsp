# Binder consistency fixtures

Copied verbatim from `quesadx/pl-lg` `tests/eval/negative/` (pinned commit
`dd1f362b35888d8a19b2215772db2389e8bb244a`) so the LSP binder can be proven to
report `E500`/`E506` with the same code, message and hint as the core evaluator.
Spans are asserted in `tests/unit/binder.test.ts`.
