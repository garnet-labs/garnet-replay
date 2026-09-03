# Benchmark

This no-publish benchmark compares source-only review with source plus the
machine-derived Execution Diff block. It records whether the review judgment,
severity, or evidence-grounded findings change between the two arms.

The run needs `ANTHROPIC_API_KEY` for model calls:

```sh
ANTHROPIC_API_KEY=... bash benchmark/run.sh
```

Use `DRY_RUN=1` to generate the blocks and result table without making a model
call:

```sh
DRY_RUN=1 bash benchmark/run.sh
```

Generated blocks and results stay local. The script does not publish output.
