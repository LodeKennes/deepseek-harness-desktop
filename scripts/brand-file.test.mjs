import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'
import { loadStyling, resolveAssetPaths } from './lib/styling.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const iconsDir = join(repoRoot, 'resources', 'icons')
const WHALE_BLUE = { r: 77, g: 107, b: 254 }

test('repo styling.json is the stock DeepSeek Harness identity', () => {
  const styling = loadStyling(repoRoot)
  assert.equal(styling.productName, 'DeepSeek Harness')
  assert.equal(styling.productNameSafe, 'DeepSeek-Harness')
  assert.equal(styling.desktopName, 'deepseek-harness')
  assert.equal(styling.appId, 'ai.deepseek.harness.desktop')
  assert.equal(styling.bootWordmark, 'HARNESS')
  assert.equal(styling.welcome, undefined)
  assert.deepEqual(styling.tokens, {})
  assert.deepEqual(resolveAssetPaths(repoRoot, styling), {})
  assert.equal(existsSync(join(repoRoot, 'styling', 'wordmark.svg')), false)
  assert.equal(existsSync(join(repoRoot, 'styling', 'logo.svg')), false)

  const chrome = readFileSync(join(repoRoot, 'styling', 'chrome.css'), 'utf8')
  assert.doesNotMatch(chrome, /Inter/)
  assert.doesNotMatch(chrome, /Archivo/)
  assert.doesNotMatch(chrome, /#E8EDE6/)
  assert.doesNotMatch(chrome, /#BF352E/)
})

test('packaged smokes look up binaries from styling.json', () => {
  const packaged = readFileSync(join(repoRoot, 'scripts/smoke-packaged.sh'), 'utf8')
  const windows = readFileSync(join(repoRoot, 'scripts/smoke-windows.sh'), 'utf8')
  assert.match(packaged, /jq -r \.productName styling\.json/)
  assert.match(packaged, /Contents\/MacOS\/\$product_name/)
  assert.match(packaged, /launch_dir\/\$desktop_name/)
  assert.match(windows, /jq -r \.productName styling\.json/)
  assert.match(windows, /\$\{product_name\}\.exe/)
  assert.match(windows, /\$\{product_name_safe\}-\*-win-/)
})

test('packaged smoke cleanup can delete a read-only AppImage extract tree', () => {
  const smoke = readFileSync(join(repoRoot, 'scripts', 'smoke-packaged.sh'), 'utf8')
  assert.match(smoke, /chmod -R u\+w "\$workdir"/)
  assert.match(smoke, /set \+e/)
})

test('desktop capabilities patch is packaged and applied after brand', () => {
  const yml = readFileSync(join(repoRoot, 'electron-builder.yml'), 'utf8')
  assert.match(yml, /from: resources\/desktop-capabilities\.cordis.yml/)
  const main = readFileSync(join(repoRoot, 'electron', 'main.ts'), 'utf8')
  assert.match(main, /resolveDesktopPatchPaths/)
  const smoke = readFileSync(join(repoRoot, 'scripts', 'smoke-sidecar.sh'), 'utf8')
  assert.match(smoke, /desktop-capabilities\.cordis.yml/)
})

test('desktop workflow uploads artifacts using styling.json productNameSafe', () => {
  const yml = readFileSync(join(repoRoot, '.github/workflows/build-desktop.yml'), 'utf8')
  assert.match(yml, /prefix=\$\(jq -r \.productNameSafe styling\.json\)/)
  assert.match(yml, /steps\.ver\.outputs\.prefix/)
})

test('installer icons are the DeepSeek whale from the GitHub repo mark', () => {
  const yml = readFileSync(join(repoRoot, 'electron-builder.yml'), 'utf8')
  assert.match(yml, /linux:\n(?:.*\n)*? {2}icon: resources\/icons/m)
  assert.match(yml, /mac:\n(?:.*\n)*? {2}icon: resources\/icons\/512\.png/m)
  assert.match(yml, /win:\n(?:.*\n)*? {2}icon: resources\/icons\/icon\.ico/m)

  const sizes = [16, 32, 48, 64, 128, 256, 512]
  for (const size of sizes) {
    const name = size === 512 ? '512.png' : `${size}x${size}.png`
    const png = readPng(join(iconsDir, name))
    assert.equal(png.width, size, name)
    assert.equal(png.height, size, name)
    assertWhalePlate(png, name)
  }

  const iconPng = readPng(join(iconsDir, 'icon.png'))
  assert.equal(iconPng.width, 512)
  assertWhalePlate(iconPng, 'icon.png')

  const ico = readFileSync(join(iconsDir, 'icon.ico'))
  assert.equal(ico.readUInt16LE(0), 0)
  assert.equal(ico.readUInt16LE(2), 1)
  assert.equal(ico.readUInt16LE(4), 6)
})

/** @param {string} path */
function readPng(path) {
  const buf = readFileSync(path)
  assert.equal(buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), true, path)
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idat = []
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset)
    const type = buf.subarray(offset + 4, offset + 8).toString('ascii')
    const data = buf.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
  assert.equal(bitDepth, 8, path)
  assert.ok(bpp, `${path}: unsupported color type ${colorType}`)
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * bpp
  const pixels = Buffer.alloc(height * stride)
  let src = 0
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[src++]
    const row = raw.subarray(src, src + stride)
    src += stride
    const out = pixels.subarray(y * stride, (y + 1) * stride)
    for (let i = 0; i < stride; i++) {
      const left = i >= bpp ? out[i - bpp] : 0
      const up = prev[i]
      const ul = i >= bpp ? prev[i - bpp] : 0
      let value = row[i]
      if (filter === 1) value = (value + left) & 255
      else if (filter === 2) value = (value + up) & 255
      else if (filter === 3) value = (value + ((left + up) >> 1)) & 255
      else if (filter === 4) {
        const p = left + up - ul
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - ul)
        const pred = pa <= pb && pa <= pc ? left : pb <= pc ? up : ul
        value = (value + pred) & 255
      } else {
        assert.equal(filter, 0, `${path}: filter ${filter}`)
      }
      out[i] = value
    }
    prev = Buffer.from(out)
  }
  return { width, height, bpp, pixels }
}

function pixelAt(png, x, y) {
  const i = (y * png.width + x) * png.bpp
  return { r: png.pixels[i], g: png.pixels[i + 1], b: png.pixels[i + 2] }
}

function assertNearWhite(color, label) {
  assert.ok(color.r > 240 && color.g > 240 && color.b > 240, `${label} ${JSON.stringify(color)}`)
}

function assertWhalePlate(png, label) {
  const last = png.width - 1
  assertNearWhite(pixelAt(png, 0, 0), `${label} nw`)
  assertNearWhite(pixelAt(png, last, 0), `${label} ne`)
  assertNearWhite(pixelAt(png, 0, last), `${label} sw`)
  assertNearWhite(pixelAt(png, last, last), `${label} se`)

  const slop = png.width <= 32 ? 40 : 20
  let whale = 0
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const color = pixelAt(png, x, y)
      if (
        Math.abs(color.r - WHALE_BLUE.r) <= slop &&
        Math.abs(color.g - WHALE_BLUE.g) <= slop &&
        Math.abs(color.b - WHALE_BLUE.b) <= slop
      ) {
        whale++
      }
    }
  }
  assert.ok(whale > png.width, `${label}: expected DeepSeek whale blue #4D6BFE, found ${whale} matching pixels`)
}
