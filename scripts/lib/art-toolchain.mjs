import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

export const artToolchain = JSON.parse(readFileSync(new URL('../../infra/art-toolchain.json', import.meta.url), 'utf8'))

export function toolchainDifferences(actual, expected = artToolchain.versions) {
  return Object.entries(expected).flatMap(([name, version]) =>
    actual[name] === version ? [] : [`${name}: expected ${version}, found ${actual[name] ?? 'unavailable'}`])
}

export function inspectArtToolchain() {
  const python = spawnSync('python3', ['-c', `
import json, platform
import numpy
from PIL import Image, features
print(json.dumps(dict(python=platform.python_version(), pillow=Image.__version__,
                     numpy=numpy.__version__, webp=features.version("webp"))))
`], { encoding: 'utf8' })
  if (python.status !== 0) throw new Error(`Python image tools are unavailable:\n${python.error?.message ?? python.stderr}`)
  const actual = JSON.parse(python.stdout)
  actual.node = process.versions.node
  for (const [command, key] of [['cwebp', 'cwebp'], ['ffmpeg', 'ffmpeg']]) {
    const result = spawnSync(command, ['-version'], { encoding: 'utf8' })
    if (result.status !== 0) throw new Error(`${command} is unavailable: ${result.error?.message ?? result.stderr}`)
    actual[key] = result.stdout.match(command === 'ffmpeg' ? /^ffmpeg version ([\d.]+)/ : /^([\d.]+)/)?.[1]
  }
  return actual
}

export function requireArtToolchain() {
  const differences = toolchainDifferences(inspectArtToolchain())
  if (differences.length) throw new Error(`Incompatible byte-exact artwork toolchain:\n${differences.join('\n')}`)
}
