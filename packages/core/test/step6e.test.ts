// @vitest-environment jsdom
/// <reference lib="dom" />
import { resolve } from 'node:path'
import { afterAll, beforeAll, it, vi } from 'vitest'
import { createStep6eCases } from '../../../tools/cases/step6e-cases.mjs'
import { setLocale } from '../../dom/src'

beforeAll(() => vi.stubGlobal('CSS', { escape: (s: string) => s.replace(/[^\w-]/g, c => `\\${c}`) }))
afterAll(() => { setLocale('zh-CN'); vi.unstubAllGlobals() })
const cases = await createStep6eCases(resolve(__dirname, '../../..'), document)
for (const [number, note, run] of cases) {
  it.each(['zh-CN', 'en'] as const)(`${number} %s ${note}`, async locale => {
    setLocale(locale); await run(document)
  }, 60000)
}
