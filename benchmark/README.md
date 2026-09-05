# Benchmark

The default reviewer is Devin. It runs both arms locally, once per seed:

```sh
bash benchmark/run.sh
```

The control arm reads the title, body, and source diff before reading the
Execution Diff block. The treatment arm reads the same material with the block
alongside it. Raw arm files are written to
`benchmark/runs/devin/<seed>.{control,treatment}.json`.

This is one pass by Devin over the 25 seeded examples. It is not an external
model run and it is not a human study.

The scoring definitions are:

```text
judgment_changed: approve|comment|request_changes differs between arms.
severity_changed: the highest issue severity differs between arms.
evidence_grounded: issues whose finding cites the record (evidence_grounded: true).
source_blind_spot: treatment raised severity with an evidence-grounded finding whose
destinations/chains appear nowhere in the control arm's text.
```

The legacy Claude path is available with `REVIEWER=claude` and requires
`ANTHROPIC_API_KEY`:

```sh
REVIEWER=claude ANTHROPIC_API_KEY=... bash benchmark/run.sh
```

Use `DRY_RUN=1` to regenerate the blocks and write a not-run result table
without running either reviewer:

```sh
DRY_RUN=1 bash benchmark/run.sh
```

Generated blocks, arm files, and results stay local. The script does not
publish output.
