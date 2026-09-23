import { expect } from "jsr:@std/expect@1.0.17"
import { findEnvFiles, indexCiphertext, renderEncrypted, renderPlaintext } from "./age.ts"

function fakeCrypto() {
  let sequence = 0
  return {
    encrypt(value: string): Promise<string> {
      return Promise.resolve(`age64:${++sequence}:${btoa(value)}`)
    },
    decrypt(value: string): Promise<string> {
      return Promise.resolve(atob(value.split(`:`)[2] ?? ``))
    },
  }
}

async function encrypt(content: string, previous = ``): Promise<string> {
  const crypto = fakeCrypto()
  return await renderEncrypted(
    content,
    await indexCiphertext(previous, crypto.decrypt),
    crypto.encrypt,
  )
}

Deno.test(`encryption rerun is byte-identical`, async () => {
  const first = await encrypt(`A=one\nB=two\n`)
  expect(await encrypt(`A=one\nB=two\n`, first)).toBe(first)
})

Deno.test(`encryption changes only modified value`, async () => {
  const first = await encrypt(`A=one\nB=two\n`)
  const second = await encrypt(`A=one\nB=changed\n`, first)
  expect(second.split(`\n`)[0]).toBe(first.split(`\n`)[0])
  expect(second.split(`\n`)[1]).not.toBe(first.split(`\n`)[1])
})

Deno.test(`encryption keeps current assignment prefix when reusing ciphertext`, async () => {
  const first = await encrypt(`A=one\n`)
  const second = await encrypt(`export A=one\n`, first)
  expect(second.startsWith(`export A=age64:`)).toBe(true)
})

Deno.test(`encryption preserves comments, blanks, and duplicate keys`, async () => {
  const source = `# header\nA=one\n\nA=two\n`
  const first = await encrypt(source)
  expect(await encrypt(source, first)).toBe(first)
  expect(first.split(`\n`).filter((line) => line.startsWith(`A=`)).length).toBe(2)
  expect(first).toContain(`# header\n`)
  expect(first).toContain(`\n\n`)
})

Deno.test(`encryption heals plaintext assignment in encrypted file`, async () => {
  const healed = await encrypt(`A=secret\n`, `A=secret\n`)
  expect(healed).not.toContain(`A=secret`)
  expect(await encrypt(`A=secret\n`, healed)).toBe(healed)
})

Deno.test(`discovery skips hidden directories, examples, and nested checkouts`, async () => {
  const root = await Deno.makeTempDir()
  try {
    await Deno.writeTextFile(`${root}/.env`, `A=1`)
    await Deno.writeTextFile(`${root}/.env.example`, `A=example`)
    await Deno.mkdir(`${root}/service`, { recursive: true })
    await Deno.writeTextFile(`${root}/service/.env.prod`, `B=2`)
    await Deno.mkdir(`${root}/.hidden`)
    await Deno.writeTextFile(`${root}/.hidden/.env`, `HIDDEN=1`)
    await Deno.mkdir(`${root}/nested`)
    await Deno.writeTextFile(`${root}/nested/.git`, `gitdir: elsewhere`)
    await Deno.writeTextFile(`${root}/nested/.env`, `NESTED=1`)

    expect(await findEnvFiles(root, false)).toEqual([
      `${root}/.env`,
      `${root}/service/.env.prod`,
    ])
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test(`decryption rejects plaintext assignment`, async () => {
  const crypto = fakeCrypto()
  await expect(renderPlaintext(`# header\nA=plaintext\n`, crypto.decrypt)).rejects.toThrow(
    `plaintext assignment at line 2`,
  )
})

Deno.test(`encryption rejects multiline value continuation`, async () => {
  await expect(encrypt(`TOKEN=first\nplaintext-continuation\n`)).rejects.toThrow(
    `unsupported env syntax at line 2`,
  )
})
