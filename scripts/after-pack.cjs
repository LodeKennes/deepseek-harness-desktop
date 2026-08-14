"use strict"

const { cpSync, existsSync, mkdirSync } = require("node:fs")
const { join } = require("node:path")

/**
 * electron-builder extraResources can omit node_modules. If the packaged
 * harness cannot resolve @deepseek-ai/dsh-app-boot, copy the staged tree.
 */
exports.default = async function afterPack(context) {
  const runtime = join(process.cwd(), "dist", "runtime")
  const markerRel = join("node_modules", "@deepseek-ai", "dsh-app-boot", "package.json")
  const product = context.packager.appInfo.productFilename
  const dest =
    context.electronPlatformName === "darwin"
      ? join(context.appOutDir, `${product}.app`, "Contents", "Resources", "harness")
      : join(context.appOutDir, "resources", "harness")

  if (existsSync(join(dest, markerRel))) {
    return
  }
  if (!existsSync(join(runtime, markerRel))) {
    throw new Error(`after-pack: staged runtime missing ${markerRel}`)
  }
  mkdirSync(dest, { recursive: true })
  cpSync(runtime, dest, { recursive: true, force: true })
  if (!existsSync(join(dest, markerRel))) {
    throw new Error(`after-pack: failed to copy ${markerRel} into ${dest}`)
  }
}
