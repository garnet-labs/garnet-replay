# Garnet Runtime Review (Cursor Bugbot adapter)

Follow `REVIEW.md` at the repository root. The pull request description carries
a `Runtime evidence (Garnet)` section between `<!-- garnet:evidence:begin -->`
and `<!-- garnet:evidence:end -->`. Use it only when its `garnet:commit` SHA
equals the pull request head; otherwise the runtime evidence is absent or stale
for this head, not clean. Prefix each runtime-grounded statement exactly with
`Runtime evidence (Garnet, head <sha7>): ` and name the execution chain,
destination and workflow/job. Never repeat verdicts or safety judgments from
the record; judge the diff yourself.
