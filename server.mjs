import { createHostedWorkspace } from "./lib/hosted-workspace.mjs"

const server = await createHostedWorkspace()
server.listen(Number(process.env.PORT ?? 3000))
