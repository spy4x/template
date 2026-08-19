/**
 * Generates VAPID keys for Web Push and writes them to infra/configs/vapid.json,
 * which compose bind-mounts into the API container as /app/vapid.json.
 */
const OUTPUT_PATH = "infra/configs/vapid.json"
const GENERATOR = "https://raw.githubusercontent.com/negrel/webpush/master/cmd/generate-vapid-keys.ts"

const { code, stdout, stderr } = await new Deno.Command("deno", {
  args: ["run", GENERATOR],
  stdout: "piped",
  stderr: "piped",
}).output()

const decoder = new TextDecoder()

if (code !== 0) {
  console.error("Error generating VAPID keys:", decoder.decode(stderr))
  Deno.exit(code)
}

await Deno.writeTextFile(OUTPUT_PATH, decoder.decode(stdout))
console.log(`VAPID keys written to ${OUTPUT_PATH}`)
