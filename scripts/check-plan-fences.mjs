import { readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLAN_DIR = join(ROOT, 'docs/superpowers/plans')
const SOURCE_DIRS = ['src', 'tests']
const SOURCE_EXTS = new Set(['.ts', '.tsx', '.css', '.json'])
const ROOT_CONFIGS = [
  'package.json',
  'electron.vite.config.ts',
  'vitest.config.ts',
  'playwright.config.ts',
  'electron-builder.yml',
  '.github/workflows/build.yml'
]
const ROOT_CONFIG_PATTERNS = [/^tsconfig.*\.json$/]

const toPosix = (p) => p.split(sep).join('/')
const rel = (p) => toPosix(relative(ROOT, p))

function fencesOf(file) {
  const lines = readFileSync(file, 'utf8').split('\n')
  const blocks = new Set()
  let i = 0
  while (i < lines.length) {
    if (lines[i].startsWith('```')) {
      let j = i + 1
      while (j < lines.length && !lines[j].startsWith('```')) j += 1
      blocks.add(lines.slice(i + 1, j).join('\n') + '\n')
      i = j + 1
    } else {
      i += 1
    }
  }
  return blocks
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

const fences = new Set()
for (const name of readdirSync(PLAN_DIR)) {
  if (name.endsWith('.md')) for (const block of fencesOf(join(PLAN_DIR, name))) fences.add(block)
}

const targets = []
for (const name of readdirSync(ROOT)) {
  if (ROOT_CONFIG_PATTERNS.some((pattern) => pattern.test(name))) targets.push(join(ROOT, name))
}
for (const name of ROOT_CONFIGS) targets.push(join(ROOT, name))
for (const dir of SOURCE_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    if (SOURCE_EXTS.has(extname(file))) targets.push(file)
  }
}

const missing = targets.filter((file) => !fences.has(readFileSync(file, 'utf8'))).map(rel).sort()

if (missing.length > 0) {
  console.error('这些文件在 docs/superpowers/plans/*.md 里没有逐字节相同的围栏：')
  for (const file of missing) console.error(`  ${file}`)
  console.error(`\n共 ${missing.length} 个文件缺失（检查 ${targets.length} 个，围栏 ${fences.size} 个）`)
  process.exit(1)
}

console.log(`OK：${targets.length} 个文件都命中至少一个围栏（围栏 ${fences.size} 个）`)
