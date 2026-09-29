---
"@iskra-bun/db-oracle": minor
---

Each call to the database (a statement, each fetch of a stream, a commit, a rollback) now has a deadline measured by the driver: its timeout plus `deadlineGrace` (by default the timeout itself, at most 5 s). In Thin mode node-oracledb cancels a call with a break on the same connection, and a session waiting on a row lock does not read it, so `callTimeout` (and an `AbortSignal`) never ended that wait and the connection was held forever. Past the deadline the call fails with a `DeadlineError`, and the driver closes the connection's socket so it leaves the pool at once; a transaction on it is lost (later statements and the commit fail without running) and the database rolls it back. An abort not honored within `deadlineGrace` (1 s by default) gives up the same way, with ORA-01013. `QueryError.timedOut` is true for NJS-123 and a `DeadlineError`.

- Statements of one transaction run one at a time, each with its own `callTimeout`: concurrent ones (a `paginate()` inside `transaction()`) overwrote each other's.
- `ping()` drops a connection that answers after `pingTimeout`.
- A statement given up outside a transaction may still run on the database once its lock frees (as it did before, when the call hung): run inside `transaction()` what must not apply late.
- **Breaking:** the deadline counts the whole call, so a query that fetches many rows in many round trips needs a `timeout` that covers all of them.
