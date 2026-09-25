# Architecture Manager

This is the standalone local product for architecture 3.4.0. It manages one user's selected architecture workspace. It does not connect to a central service and does not share runtime data with other users.

P1 currently contains a read-only workspace inventory scanner:

```text
node src/cli.mjs E:\\ai
node --test
```

The scanner never writes to the selected workspace. Future write operations must use the plan → apply → verify boundary from the 3.4.0 implementation table.
