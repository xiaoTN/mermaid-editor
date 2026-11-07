import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { hasHardcodedChinese } from './ui-source-scan.mts'

const scan = (source: string, fileName = 'fixture.ts') => hasHardcodedChinese(source, fileName)

test('ignores line, block, JSDoc, trailing and template-expression comments', () => {
  const source = [
    '// 中文',
    '/** 中文\n * 中文 */',
    'const a = 1 /* 中文 */; // 中文',
    'const b = `hello ${ /* 中文 */ a } world`;'
  ].join('\n')
  assert.equal(scan(source), false)
})

test('ignores real boxSelection comments', () => {
  const source = readFileSync(new URL('../../packages/dom/src/boxSelection.ts', import.meta.url), 'utf8')
  assert.equal(scan(source), false)
})

test('detects literals even beside comments and comment-like text', () => {
  for (const source of [
    `const s = '中文' // comment`,
    `const s = "https://example.test/中文"`,
    `const s = '/* 中文 */'`,
    'const s = `hello 中文 ${x}`',
    'const s = `hello ${"中文"}`',
    'const s = `hello ${ /* comment */ `中文 ${x}` }`',
    'const pattern = /中文/',
    `const 中文 = 1`,
    `const s = '\\u4e2d\\u6587'`,
    'const s = `\\u{20000}`',
    `const s = '𠀀'`,
  ]) assert.equal(scan(source), true, source)
})

test('handles JSX text, attributes, expressions and actual JSX comments', () => {
  for (const source of [
    '<div>中文</div>',
    '<div>// 中文</div>',
    '<div>/* 中文 */</div>',
    '<div title="中文" />',
    '<div>{"中文"}</div>',
    '<div>{`中文 ${x}`}</div>',
    '<div>&#20013;</div>',
    '<div title="&#x4e2d;" />',
  ]) assert.equal(scan(source, 'fixture.tsx'), true, source)
  assert.equal(scan('<div>{/* 中文 */}<span>English</span></div>', 'fixture.tsx'), false)
})
