/**
 * Convert ESM modules to CJS in a bare-pack bundle, for engines whose Bare
 * port can't load ES modules (JSC on iOS/macOS, QuickJS on Android).
 *
 * Bare-pack bundles include modules verbatim — ESM packages keep
 * import/export syntax. This runs esbuild (format: 'cjs', dynamic import()
 * lowered to a require shim) on every .js/.mjs/.cjs file and removes
 * "type": "module" from package.json files.
 *
 * Note: .mjs files keep their extension — the generated worklet entry patches
 * Module._extensions['.mjs'] at runtime to load them as CJS (see
 * generators/mjs-as-cjs-patch.ts).
 *
 * The bundle byte format (`<N>\n<JSON>\n<DATA>`) is owned by bare-bundle's
 * Bundle class (the same code Bare uses to load bundles on device) — this
 * module only unwraps the optional bare-pack output wrapper, rewrites file
 * contents through Bundle.from()/write()/toBuffer(), and restores the
 * wrapper. No manual header/offset arithmetic.
 */

import fs from 'fs'
import { transformSync } from 'esbuild'
import Bundle from 'bare-bundle'

/**
 * Text encoding used when bare-pack stringifies the bundle into its wrapped
 * output formats (`module.exports = "..."` etc). bare-pack supports other
 * encodings via `--encoding` (e.g. base64), but defaults to utf8 and this
 * package never passes the flag — a non-utf8 wrapped bundle is not supported
 * here and would fail parseHeader/Bundle.from after unwrapping.
 */
const BUNDLE_TEXT_ENCODING: BufferEncoding = 'utf8'

/**
 * bare-pack writes the raw bundle verbatim only for the `.bundle` output.
 * For `.bundle.js`/`.bundle.cjs` (the hrpc default, imported by Metro) it
 * wraps it as `module.exports = <json-string>\n`, for `.bundle.mjs` as
 * `export default <json-string>\n`, and for `.bundle.json` as the bare
 * `<json-string>\n`. Conversion rewrites the bundle bytes, so the wrapper is
 * stripped first and restored afterwards so the artifact stays importable.
 */
type BundleWrapper = 'cjs' | 'mjs' | 'json'

const WRAPPERS: Array<{ kind: BundleWrapper, prefix: string }> = [
  { kind: 'cjs', prefix: 'module.exports = ' },
  { kind: 'mjs', prefix: 'export default ' }
]

function unwrapBundle (raw: Buffer): { wrapper: BundleWrapper | null, bundle: Buffer } {
  const head = raw.subarray(0, 32).toString(BUNDLE_TEXT_ENCODING)
  for (const { kind, prefix } of WRAPPERS) {
    if (head.startsWith(prefix)) {
      // Right-hand side is a JSON string literal; JSON.parse tolerates the
      // trailing newline bare-pack appends.
      const bundleStr = JSON.parse(raw.subarray(prefix.length).toString(BUNDLE_TEXT_ENCODING)) as string
      return { wrapper: kind, bundle: Buffer.from(bundleStr, BUNDLE_TEXT_ENCODING) }
    }
  }
  // A raw bundle starts with the numeric header length; .bundle.json is the
  // whole bundle as one JSON string literal, so it starts with a quote.
  if (head.startsWith('"')) {
    const bundleStr = JSON.parse(raw.toString(BUNDLE_TEXT_ENCODING)) as string
    return { wrapper: 'json', bundle: Buffer.from(bundleStr, BUNDLE_TEXT_ENCODING) }
  }
  return { wrapper: null, bundle: raw }
}

function rewrapBundle (wrapper: BundleWrapper | null, bundle: Buffer): Buffer {
  if (wrapper === null) return bundle
  const str = JSON.stringify(bundle.toString(BUNDLE_TEXT_ENCODING))
  if (wrapper === 'json') return Buffer.from(`${str}\n`)
  const prefix = WRAPPERS.find(w => w.kind === wrapper)!.prefix
  return Buffer.from(`${prefix}${str}\n`)
}

/** Buffer-typed views over the bare-bundle API (its .d.ts uses bare types). */
function readFile (bundle: Bundle, key: string): Buffer {
  return bundle.read(key) as unknown as Buffer
}
function writeFile (bundle: Bundle, key: string, data: Buffer): void {
  // Preserve the original file mode — write() would otherwise reset it.
  bundle.write(key, data as unknown as string, { mode: bundle.mode(key) })
}

export interface ConvertOptions {
  minify?: boolean
  verbose?: boolean
}

export function convertBundleEsmToCjs (bundlePath: string, options: ConvertOptions = {}): void {
  const { minify = true, verbose = false } = options

  const { wrapper, bundle: raw } = unwrapBundle(fs.readFileSync(bundlePath))
  const bundle = Bundle.from(raw as unknown as Parameters<typeof Bundle.from>[0])

  let converted = 0
  let pkgPatched = 0
  const failures: string[] = []

  for (const key of bundle.keys()) {
    const content = readFile(bundle, key)

    if (key.endsWith('.js') || key.endsWith('.mjs') || key.endsWith('.cjs')) {
      try {
        const result = transformSync(content.toString(), {
          format: 'cjs',
          target: 'es2020',
          // format:'cjs' alone leaves dynamic import() untouched; marking it
          // unsupported lowers import(x) to a require-based shim so no ESM
          // constructs survive on CJS-only engines.
          supported: { 'dynamic-import': false },
          minify,
          legalComments: minify ? 'none' : 'eof'
        })
        writeFile(bundle, key, Buffer.from(result.code))
        converted++
      } catch (e) {
        const msg = e instanceof Error ? e.message.split('\n')[0] : String(e)
        if (verbose) console.error(`  FAIL ${key}: ${msg}`)
        failures.push(`${key}: ${msg}`)
      }
    } else if (key.endsWith('/package.json')) {
      // bare-pack had to parse every package.json to resolve the graph, so
      // one that no longer parses means we corrupted it — fail, don't skip.
      let pkg: { type?: string }
      try {
        pkg = JSON.parse(content.toString()) as { type?: string }
      } catch (e) {
        failures.push(`${key}: unreadable package.json after bundling: ${e instanceof Error ? e.message : String(e)}`)
        continue
      }
      if (pkg.type === 'module') {
        delete pkg.type
        writeFile(bundle, key, Buffer.from(JSON.stringify(pkg)))
        pkgPatched++
      }
    } else if (key.endsWith('.json') && minify) {
      try {
        writeFile(bundle, key, Buffer.from(JSON.stringify(JSON.parse(content.toString()))))
      } catch {
        // Minification is cosmetic — keep the original bytes, but surface it.
        if (verbose) console.error(`  skip minify (not valid JSON): ${key}`)
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(`ESM→CJS conversion failed for ${failures.length} file(s) in bundle:\n  - ${failures.slice(0, 10).join('\n  - ')}`)
  }

  // Note: header.id (stamped by bare-pack from the original contents) is
  // carried over as-is, matching previous behaviour; nothing verifies it at
  // load time today.
  fs.writeFileSync(bundlePath, rewrapBundle(wrapper, Buffer.from(bundle.toBuffer())))

  // Re-read and validate the final artifact so a converter regression fails
  // the build here rather than at load time on a device.
  validateBundle(bundlePath)

  if (!options.verbose) {
    console.log(`  ESM→CJS: converted ${converted} JS files, patched ${pkgPatched} package.json files`)
  }
}

interface HeaderFileInfo { offset: number, length: number }

/**
 * Parse the bundle header independently of bare-bundle, using the exact
 * length prefix the format specifies: `<N>` followed by `\n<JSON>\n` where N
 * is the byte length of that newline-delimited JSON region.
 */
function parseHeader (buf: Buffer): { files: Record<string, HeaderFileInfo>, dataStart: number } {
  let end = 0
  while (buf[end] >= 0x30 && buf[end] <= 0x39) end++
  const N = parseInt(buf.toString(BUNDLE_TEXT_ENCODING, 0, end), 10)
  if (!Number.isFinite(N)) throw new Error('Bundle does not start with a header length')
  const header = JSON.parse(buf.toString(BUNDLE_TEXT_ENCODING, end, end + N)) as { files?: Record<string, HeaderFileInfo> }
  if (!header.files) throw new Error('No files map in bundle header')
  return { files: header.files, dataStart: end + N }
}

/**
 * Validate a converted bundle on disk (wrapped or raw). Build-time guard run
 * automatically after conversion so a malformed artifact fails the build
 * instead of crashing on-device:
 *  - wrapper unwraps and the bundle parses (both via our exact-length header
 *    parse and via bare-bundle's own Bundle.from, the code that runs on device)
 *  - offsets == cumsum(lengths) and data length == sum(lengths)
 *  - every JS file parses as CJS and no dynamic import() survives
 *  - no package.json still declares "type": "module"
 *  - header main (when present) exists in the file map
 * Throws with the full list of problems on failure.
 */
export function validateBundle (bundlePath: string): void {
  const problems: string[] = []

  const { bundle: raw } = unwrapBundle(fs.readFileSync(bundlePath))

  // Independent structural check: bare-bundle reads files sequentially by
  // length and never consults offsets, so stale offsets would slip through
  // Bundle.from — verify them explicitly against the header.
  const { files, dataStart } = parseHeader(raw)
  let expectedOffset = 0
  for (const [key, info] of Object.entries(files)) {
    if (info.offset !== expectedOffset) {
      problems.push(`offset drift at ${key}: expected ${expectedOffset}, header says ${info.offset}`)
      expectedOffset = info.offset
    }
    expectedOffset += info.length
  }
  const dataLength = raw.length - dataStart
  if (dataLength !== expectedOffset) {
    problems.push(`data length mismatch: header accounts for ${expectedOffset} bytes, bundle has ${dataLength}`)
  }

  // Field/shape validation through the same code that loads bundles on device.
  const bundle = Bundle.from(raw as unknown as Parameters<typeof Bundle.from>[0])

  if (bundle.main !== null && !bundle.exists(bundle.main)) {
    problems.push(`main '${bundle.main}' is not in the file map`)
  }

  for (const key of bundle.keys()) {
    const content = readFile(bundle, key).toString()

    if (/\.(js|mjs|cjs)$/.test(key)) {
      try {
        // CJS files execute inside a function wrapper, so this parse matches
        // the loader; static import/export are syntax errors here.
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        new Function(content)
      } catch (e) {
        problems.push(`${key} is not valid CJS: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`)
      }
      if (/[^.\w]import\s*\(/.test(content)) {
        problems.push(`${key} still contains a dynamic import()`)
      }
    } else if (key.endsWith('/package.json')) {
      try {
        const pkg = JSON.parse(content) as { type?: string }
        if (pkg.type === 'module') problems.push(`${key} still declares "type": "module"`)
      } catch (e) {
        // Valid at pack time (bare-pack parsed it) — unparseable now means
        // the bundle rewrite corrupted it.
        problems.push(`${key} is not valid JSON: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`)
      }
    }
  }

  if (problems.length > 0) {
    const shown = problems.slice(0, 20)
    const more = problems.length - shown.length
    throw new Error(
      `Bundle validation failed for ${bundlePath}:\n  - ${shown.join('\n  - ')}` +
      (more > 0 ? `\n  ...and ${more} more` : '')
    )
  }
}
