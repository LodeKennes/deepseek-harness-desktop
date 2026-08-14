#!/usr/bin/env node
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const stage = process.argv[2]
if (!stage) {
  console.error('usage: assert-desktop-brand.mjs <stage-dir>')
  process.exit(2)
}

const pkg = join(stage, 'node_modules', 'desktop-brand', 'package.json')
const host = join(stage, 'node_modules', 'desktop-brand', 'lib', 'index.js')
if (!existsSync(pkg) || !existsSync(host)) {
  console.error(`error: desktop-brand missing under ${stage}/node_modules`)
  process.exit(1)
}

const require = createRequire(pathToFileURL(join(stage, 'package.json')))
const resolved = require.resolve('desktop-brand/package.json')
if (!existsSync(resolved)) {
  console.error(`error: resolved desktop-brand is missing: ${resolved}`)
  process.exit(1)
}
console.log(`assert-desktop-brand: ${resolved}`)
