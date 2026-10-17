import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SCAN_ROOT = join(ROOT, 'src/renderer')
const FORBIDDEN_DIRS = ['src/main', 'src/preload']
const FORBIDDEN_MODULE = 'src/core/decode'

const toPosix = (p) => p.split(sep).join('/')
const rel = (p) => toPosix(relative(ROOT, p))

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

function specifiersOf(file) {
  const text = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found = []
  const record = (literal) => {
    if (!literal || !ts.isStringLiteralLike(literal)) return
    const { line } = sf.getLineAndCharacterOfPosition(literal.getStart(sf))
    found.push({ spec: literal.text, line: line + 1 })
  }
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      record(node.moduleSpecifier)
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      record(node.moduleReference.expression)
    } else if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const dynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword
      const required = ts.isIdentifier(node.expression) && node.expression.text === 'require'
      if (dynamic || required) record(node.arguments[0])
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

function targetOf(file, spec) {
  if (spec.startsWith('.')) return rel(resolve(dirname(file), spec))
  if (spec.startsWith('src/')) return spec
  return null
}

function reasonOf(file, spec) {
  if (spec.startsWith('node:')) return 'node 内置模块'
  if (spec === 'electron' || spec.startsWith('electron/')) return 'electron 模块'
  if (spec === 'core/decode' || spec.startsWith('core/decode/')) return 'core/decode（只有 main 能用）'
  const target = targetOf(file, spec)
  if (!target) return null
  if (target === FORBIDDEN_MODULE || target.startsWith(`${FORBIDDEN_MODULE}.`)) {
    return 'core/decode（只有 main 能用）'
  }
  for (const dir of FORBIDDEN_DIRS) {
    if (target === dir || target.startsWith(`${dir}/`)) return `${dir}（只有 main/preload 自己能用）`
  }
  return null
}

const violations = []
let scanned = 0
for (const file of walk(SCAN_ROOT)) {
  scanned += 1
  for (const { spec, line } of specifiersOf(file)) {
    const reason = reasonOf(file, spec)
    if (reason) violations.push(`${rel(file)}:${line}: ${spec}（渲染层禁止 import ${reason}）`)
  }
}

if (violations.length > 0) {
  console.error('渲染层 import 越界：')
  for (const violation of violations) console.error(`  ${violation}`)
  console.error(`\n共 ${violations.length} 处（扫描 ${scanned} 个文件）`)
  process.exit(1)
}

console.log(`OK：src/renderer 下 ${scanned} 个文件没有越界 import`)
