import { config } from "@api/services/config.ts"

export type WorkspaceInfo = {
  path: string
  repoFullName: string
}

export async function ensureWorkspace(repoFullName: string): Promise<WorkspaceInfo> {
  const safeName = repoFullName.replace(/\W+/g, "-")
  const path = `${config.github.workspaceRoot}/${safeName}`
  await Deno.mkdir(path, { recursive: true })
  return { path, repoFullName }
}
