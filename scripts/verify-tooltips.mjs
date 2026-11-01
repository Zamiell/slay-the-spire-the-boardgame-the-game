import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

const violations = []
const redundantBack = []
function audit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) { audit(path); continue }
    if (!path.endsWith('.tsx')) continue
    const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    function visit(node) {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(file) === 'Tooltip') {
        const name = node.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(file) === 'name')
        const value = name?.initializer && ts.isJsxExpression(name.initializer) ? name.initializer.expression : name?.initializer
        if (value && ts.isStringLiteralLike(value) && value.text === 'Back')
          redundantBack.push(`${path}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}`)
      }
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
          /^[a-z]/.test(node.tagName.getText(file))) {
        for (const attribute of node.attributes.properties) {
          if (ts.isJsxAttribute(attribute) && attribute.name.getText(file) === 'title') {
            const { line } = file.getLineAndCharacterOfPosition(attribute.getStart(file))
            violations.push(`${path}:${line + 1}`)
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(file)
  }
}
audit('src/ui')
assert.deepEqual(violations, [], 'Use shared custom help instead of native HTML title tooltips')
assert.deepEqual(redundantBack, [], 'Return arrows should keep their accessible names, not redundant Back tooltips')
console.log('PASS all UI intrinsic elements use custom tooltips; component heading props remain allowed')
