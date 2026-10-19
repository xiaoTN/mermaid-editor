import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { messages, listKeys } from '../../packages/dom/src/i18n/index.ts'

const data = Object.fromEntries(Object.entries(messages).map(([locale, bundle]) =>
  [locale, Object.fromEntries(listKeys().map(key => [key, bundle[key]]))]))
const json = JSON.stringify(data, null, 2) + '\n'
const output = fileURLToPath(new URL('../../out/i18n/', import.meta.url))
mkdirSync(output, { recursive: true })
writeFileSync(output + 'keys.json', json, 'utf8')
process.stdout.write(json)
