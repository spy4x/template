const sourceRoots = ["apps", "e2e", "infra/scripts", "libs", "tests"]
const sourceFiles: string[] = []
// Owner: platform maintainer. Extraction tracked in docs/homelab-extraction-inventory.md.
const excludedSourceFiles = new Set(["infra/scripts/db-backup-create.ts"])

async function collectSourceFiles(path: string): Promise<void> {
  for await (const entry of Deno.readDir(path)) {
    const entryPath = `${path}/${entry.name}`
    if (entry.isDirectory) {
      await collectSourceFiles(entryPath)
    } else if (
      entry.isFile &&
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !excludedSourceFiles.has(entryPath)
    ) {
      sourceFiles.push(entryPath)
    }
  }
}

for (const sourceRoot of sourceRoots) {
  await collectSourceFiles(sourceRoot)
}

for await (const entry of Deno.readDir(".")) {
  if (entry.isFile && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
    sourceFiles.push(entry.name)
  }
}

sourceFiles.sort()

const command = new Deno.Command("deno", {
  args: ["check", ...sourceFiles],
  stdin: "null",
  stdout: "inherit",
  stderr: "inherit",
})
const status = await command.spawn().status

if (!status.success) {
  Deno.exit(status.code)
}
