import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const wrapper = resolve(import.meta.dirname, '../infra/t3-checkpoint-git.py')
const base = join(homedir(), '.cache/task-tmp')
mkdirSync(base, { recursive: true })
const temporary = mkdtempSync(join(base, 'verify-t3-checkpoint-'))
const git = (cwd, args, env = {}, executable = '/usr/bin/git') => {
  const result = spawnSync(executable, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8' })
  assert.equal(result.status, 0, `${executable} ${args.join(' ')}: ${result.stderr}`)
  return result.stdout.trim()
}
const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

function capture(cwd, executable) {
  const common = git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  const index = join(common, `t3-checkpoint-index-${randomUUID()}`)
  const env = { GIT_INDEX_FILE: index }
  try {
    git(cwd, ['read-tree', 'HEAD'], env, executable)
    git(cwd, ['add', '-A', '--', '.'], env, executable)
    return git(cwd, ['write-tree'], env, executable)
  } finally {
    rmSync(index, { force: true })
    rmSync(`${index}.lock`, { force: true })
  }
}

function verify(cwd) {
  writeFileSync(join(cwd, 'tracked'), 'staged')
  git(cwd, ['add', 'tracked'])
  writeFileSync(join(cwd, 'tracked'), 'unstaged')
  git(cwd, ['rm', '--cached', 'ignored'])
  unlinkSync(join(cwd, 'deleted'))
  writeFileSync(join(cwd, 'untracked space'), 'new file')
  git(cwd, ['update-index', '--assume-unchanged', 'assumed'])
  git(cwd, ['update-index', '--skip-worktree', 'skipped'])
  writeFileSync(join(cwd, 'assumed'), 'changed despite assume-unchanged')
  writeFileSync(join(cwd, 'skipped'), 'changed despite skip-worktree')
  const index = git(cwd, ['rev-parse', '--path-format=absolute', '--git-path', 'index'])
  const before = digest(index)
  const status = git(cwd, ['status', '--porcelain'])
  const expected = capture(cwd, '/usr/bin/git')
  const actual = capture(cwd, wrapper)
  assert.equal(actual, expected, `cached capture differs from T3 capture: ${git(cwd, ['diff', expected, actual])}`)
  assert.equal(git(cwd, ['show', `${expected}:tracked`]), 'unstaged')
  assert.equal(git(cwd, ['show', `${expected}:ignored`]), 'ignored but tracked in HEAD')
  assert.equal(git(cwd, ['show', `${expected}:untracked space`]), 'new file')
  assert.equal(git(cwd, ['show', `${expected}:assumed`]), 'changed despite assume-unchanged')
  assert.equal(git(cwd, ['show', `${expected}:skipped`]), 'changed despite skip-worktree')
  assert(!git(cwd, ['ls-tree', '--name-only', expected]).split('\n').includes('deleted'))
  assert.equal(digest(index), before, 'checkpoint changed the developer index')
  assert.equal(git(cwd, ['status', '--porcelain'], {}, wrapper), status, 'ordinary Git passthrough changed behavior')
}

try {
  const repository = join(temporary, 'repo')
  mkdirSync(repository)
  git(repository, ['init', '-q'])
  git(repository, ['config', 'user.name', 'Checkpoint fixture'])
  git(repository, ['config', 'user.email', 'checkpoint@example.test'])
  git(repository, ['config', 'core.hooksPath', '/dev/null'])
  for (const file of ['tracked', 'deleted', 'assumed', 'skipped']) writeFileSync(join(repository, file), 'initial')
  writeFileSync(join(repository, 'ignored'), 'ignored but tracked in HEAD')
  git(repository, ['add', '.'])
  git(repository, ['-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture'])
  writeFileSync(join(repository, '.gitignore'), 'ignored\n')
  git(repository, ['add', '.gitignore'])
  git(repository, ['-c', 'commit.gpgsign=false', 'commit', '-qm', 'ignore existing tracked file'])
  const linked = join(temporary, 'linked')
  git(repository, ['worktree', 'add', '--detach', linked, 'HEAD'])
  verify(repository)
  git(linked, ['update-index', '--split-index'])
  verify(linked)
  const blob = git(repository, ['rev-parse', 'HEAD:tracked'])
  const conflict = spawnSync('/usr/bin/git', ['update-index', '--index-info'], { cwd: repository,
    input: `0 ${'0'.repeat(40)}\ttracked\n${[1, 2, 3].map((stage) => `100644 ${blob} ${stage}\ttracked\n`).join('')}`, encoding: 'utf8' })
  assert.equal(conflict.status, 0, conflict.stderr)
  const conflictedIndex = join(repository, '.git/index')
  const beforeConflict = digest(conflictedIndex)
  assert.equal(capture(repository, wrapper), capture(repository, '/usr/bin/git'), 'unmerged index changed the checkpoint')
  assert.equal(digest(conflictedIndex), beforeConflict, 'capture changed the developer conflict stages')
  console.log('✓ T3 cached checkpoints match fresh captures with edits, ignored tracked files, flags, conflicts and linked/split indexes; developer indexes stay untouched')
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
