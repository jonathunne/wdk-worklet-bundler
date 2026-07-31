/**
 * Convert ESM modules to CJS in a bare-pack bundle for JSC compatibility.
 *
 * Bare-pack bundles include modules verbatim — ESM packages keep
 * import/export syntax that JSC can't handle via CJS require().
 * This runs esbuild (format: 'cjs') on all .js/.mjs/.cjs files and
 * removes "type": "module" from package.json files.
 *
 * Note: .mjs files keep their extension — the worklet patches
 * Module._extensions['.mjs'] at runtime to load them as CJS.
 *
 * Note: BundleWrapper is used to detect and restore the wrapper that bare-pack adds to
 * the raw bundle for .bundle.js/.bundle.cjs/.bundle.mjs/.bundle.json. The ESM→CJS
 * conversion rewrites the bare-pack byte layout, so we must strip any such wrapper
 * first (otherwise parseBundle sees JS source, not the header) and restore the exact
 * same wrapper afterwards so the artifact stays importable.
 * Bundle format: <N>\n<JSON>\n<DATA>
 * where N = JSON.length + 2, offsets in header.files are relative to DATA.
 */

import fs from 'fs'
import { transformSync } from 'esbuild'

interface FileInfo {
  offset: number
  length: number
}

interface BundleHeader {
  files: Record<string, FileInfo>
}

function parseBundle (buf: Buffer): { header: BundleHeader, dataStart: number } {
  const nl = buf.indexOf(0x0a)
  const headerStart = nl + 1
  const headerArea = buf.subarray(headerStart, headerStart + parseInt(buf.subarray(0, nl).toString(), 10) + 10).toString()

  let depth = 0
  let jsonEnd = -1
  for (let i = 0; i < headerArea.length; i++) {
    if (headerArea[i] === '{') depth++
    if (headerArea[i] === '}') depth--
    if (depth === 0) { jsonEnd = i + 1; break }
  }
  if (jsonEnd < 0) throw new Error('Could not find JSON end in bundle header')

  const header = JSON.parse(buf.subarray(headerStart, headerStart + jsonEnd).toString()) as BundleHeader
  const dataStart = headerStart + jsonEnd + 1
  return { header, dataStart }
}

// Type of the wrapper that bare-pack adds to the raw bundle
type BundleWrapper = 'cjs' | 'mjs' | 'json'

const WRAPPERS: Array<{ kind: BundleWrapper, prefix: string }> = [
  { kind: 'cjs', prefix: 'module.exports = ' },
  { kind: 'mjs', prefix: 'export default ' }
]

function unwrapBundle (raw: Buffer): { wrapper: BundleWrapper | null, bundle: Buffer } {
  const head = raw.subarray(0, 32).toString('utf8')
  for (const { kind, prefix } of WRAPPERS) {
    if (head.startsWith(prefix)) {
      // Right-hand side is a JSON string literal
      const bundleStr = JSON.parse(raw.subarray(prefix.length).toString('utf8')) as string
      return { wrapper: kind, bundle: Buffer.from(bundleStr, 'utf8') }
    }
  }
  // A raw bundle starts with the numeric header length; .bundle.json is the
  // whole bundle as one JSON string literal, so it starts with a quote.
  if (head.startsWith('"')) {
    const bundleStr = JSON.parse(raw.toString('utf8')) as string
    return { wrapper: 'json', bundle: Buffer.from(bundleStr, 'utf8') }
  }
  return { wrapper: null, bundle: raw }
}

function rewrapBundle (wrapper: BundleWrapper | null, bundle: Buffer): Buffer {
  if (wrapper === null) return bundle
  const str = JSON.stringify(bundle.toString('utf8'))
  if (wrapper === 'json') return Buffer.from(`${str}\n`)
  const prefix = WRAPPERS.find(w => w.kind === wrapper)!.prefix
  return Buffer.from(`${prefix}${str}\n`)
}

export interface ConvertOptions {
  minify?: boolean
  verbose?: boolean
}

export function convertBundleEsmToCjs (bundlePath: string, options: ConvertOptions = {}): void {
  const { minify = true, verbose = false } = options

  const { wrapper, bundle: buf } = unwrapBundle(fs.readFileSync(bundlePath))
  const { header, dataStart } = parseBundle(buf)

  const files = header.files
  if (!files) throw new Error('No files map in bundle header')

  const sortedEntries = Object.entries(files)
    .filter(([, info]) => info.offset !== undefined)
    .sort((a, b) => a[1].offset - b[1].offset)

  const newBuffers: Buffer[] = []
  let converted = 0
  let failed = 0
  let pkgPatched = 0

  for (const [filePath, info] of sortedEntries) {
    const originalContent = buf.subarray(dataStart + info.offset, dataStart + info.offset + info.length)
    let newContent = originalContent

    if (filePath.endsWith('.js') || filePath.endsWith('.mjs') || filePath.endsWith('.cjs')) {
      try {
        const result = transformSync(originalContent.toString(), {
          format: 'cjs',
          target: 'es2020',
          supported: { 'dynamic-import': false },
          minify,
          legalComments: minify ? 'none' : 'eof'
        })
        newContent = Buffer.from(result.code)
        converted++
      } catch (e) {
        if (verbose) {
          const msg = e instanceof Error ? e.message : String(e)
          console.error(`  FAIL ${filePath}: ${msg.split('\n')[0]}`)
        }
        failed++
      }
    } else if (filePath.endsWith('/package.json')) {
      try {
        const pkg = JSON.parse(originalContent.toString()) as { type?: string }
        if (pkg.type === 'module') {
          delete pkg.type
          newContent = Buffer.from(JSON.stringify(pkg))
          pkgPatched++
        }
      } catch { /* skip malformed json */ }
    } else if (filePath.endsWith('.json') && minify) {
      try {
        newContent = Buffer.from(JSON.stringify(JSON.parse(originalContent.toString())))
      } catch { /* skip */ }
    }

    newBuffers.push(newContent)
  }

  if (failed > 0) {
    throw new Error(`ESM→CJS conversion failed for ${failed} file(s) in bundle`)
  }

  // Recalculate offsets with new lengths
  let offset = 0
  for (let i = 0; i < sortedEntries.length; i++) {
    sortedEntries[i][1].offset = offset
    sortedEntries[i][1].length = newBuffers[i].length
    offset += newBuffers[i].length
  }

  // Rebuild bundle
  const newData = Buffer.concat(newBuffers)
  const newJsonStr = JSON.stringify(header)
  const N = newJsonStr.length + 2
  const newBundle = Buffer.concat([
    Buffer.from(N.toString() + '\n'),
    Buffer.from(newJsonStr),
    Buffer.from('\n'),
    newData
  ])

  fs.writeFileSync(bundlePath, rewrapBundle(wrapper, newBundle))

  if (!options.verbose) {
    console.log(`  ESM→CJS: converted ${converted} JS files, patched ${pkgPatched} package.json files`)
  }
}
