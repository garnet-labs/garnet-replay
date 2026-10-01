/** Saved replays shown first on the landing page, each with what it demonstrates. */
export const FEATURED = [
  {
    id: "replays/github/garnet-labs/garnet-runtime-review-reference/31.json",
    note: "Reference repository. Both jobs recorded; api.ipify.org, httpbin.org and ip-api.com appear in the workload only after the dependency change.",
  },
  {
    id: "replays/github/garnet-labs/OpenHands/10.json",
    note: "Upstream change replayed on a fork. Adding KaTeX brought one new workload connection, cdn.npmmirror.com.",
  },
  {
    id: "replays/github/garnet-labs/deepsec/11.json",
    note: "Agent CLI upgrade. New workload connections (telemetry.nextjs.org, Google Fonts) are kept apart from runner background.",
  },
  {
    id: "replays/github/garnet-labs/dub/37.json",
    note: "Eleven dependency bumps with no workload difference; only runner background moved.",
  },
  {
    id: "replays/github/garnet-labs/garnet-runtime-review-demo/30376868306.json",
    note: "Constructed teaching record of install-time egress, labelled as constructed.",
  },
]
