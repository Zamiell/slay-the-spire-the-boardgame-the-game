import { randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

function segment(value) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) throw new Error(`Invalid verification output identity: ${value}`)
  return value
}

export function verificationRunId() {
  process.env.STS_VERIFY_RUN_ID ??= `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
  return segment(process.env.STS_VERIFY_RUN_ID)
}

/** Workers inherit the run identity; independent invocations never share an output directory. */
export function browserOutputDirectory(root, suite = 'batch', runId = verificationRunId()) {
  return join(root, 'artifacts/verification/browser', segment(suite), segment(runId))
}

export function createBuildOutput(root) {
  const parent = join(root, 'artifacts/verification/build')
  mkdirSync(parent, { recursive: true })
  return mkdtempSync(join(parent, 'run-'))
}

export function checkedBuildOutput(root, output) {
  const path = resolve(output)
  if (dirname(path) !== resolve(root, 'artifacts/verification/build') ||
    !/^run-[a-zA-Z0-9]+$/.test(basename(path)) ||
    !lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink() || readdirSync(path).length !== 0) {
    throw new Error('Verification builds require a fresh, empty directory under artifacts/verification/build')
  }
  return path
}
