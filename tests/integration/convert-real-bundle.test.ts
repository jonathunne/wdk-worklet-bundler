/**
 * Integration test: run the REAL bare-pack binary against a fixture project,
 * convert its output, and verify the result both structurally and by
 * executing the converted bundle under a CJS-only module loader (what a
 * JSC/QuickJS worklet effectively is once the .mjs extension patch applies).
 *
 * Unlike the unit tests, nothing here reimplements bare-pack's output —
 * wrapper shape, header layout, and resolutions all come from bare-pack
 * itself, so a bare-pack format change breaks this test instead of silently
 * diverging from our assumptions.
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { execFileSync } from 'child_process'
import { convertBundleEsmToCjs } from '../../src/bundler/convert-esm-to-cjs'

const BARE_PACK = path.join(__dirname, '../../node_modules/.bin/bare-pack')

interface FileInfo { offset: number, length: number }
interface Header {
  main: string
  files: Record<string, FileInfo>
  resolutions?: Record<string, Record<string, string>>
}

function parseRawBundle (buf: Buffer): { header: Header, dataStart: number } {
  const nl = buf.indexOf(0x0a)
  const N = parseInt(buf.subarray(0, nl).toString(), 10)
  const headerStart = nl + 1
  const jsonEnd = headerStart + N - 2
  const header = JSON.parse(buf.subarray(headerStart, jsonEnd).toString()) as Header
  return { header, dataStart: jsonEnd + 1 }
}

function unwrap (raw: Buffer): { prefix: string, bundle: Buffer } {
  const head = raw.subarray(0, 32).toString()
  for (const prefix of ['module.exports = ', 'export default ']) {
    if (head.startsWith(prefix)) {
      return { prefix, bundle: Buffer.from(JSON.parse(raw.subarray(prefix.length).toString()) as string) }
    }
  }
  if (head.startsWith('"')) {
    return { prefix: '"', bundle: Buffer.from(JSON.parse(raw.toString()) as string) }
  }
  return { prefix: '', bundle: raw }
}

/**
 * Minimal CJS-only loader over a parsed bundle: every file loads as CJS
 * regardless of extension, specifiers resolve through header.resolutions —
 * mirroring a Bare worklet with the .mjs-as-CJS patch active.
 */
type ModuleFactory = (
  module: { exports: unknown },
  exports: unknown,
  require: (spec: string) => unknown,
  filename: string,
  dirname: string
) => void

function makeLoader (buf: Buffer): { requireFile: (f: string) => unknown, header: Header, contents: Record<string, string> } {
  const { header, dataStart } = parseRawBundle(buf)
  const contents: Record<string, string> = {}
  for (const [p, info] of Object.entries(header.files)) {
    contents[p] = buf.subarray(dataStart + info.offset, dataStart + info.offset + info.length).toString()
  }

  const cache: Record<string, { exports: unknown }> = {}
  const resolve = (spec: string, from: string): string => {
    const viaHeader = header.resolutions?.[from]?.[spec]
    if (viaHeader) return viaHeader
    if (spec.startsWith('.')) {
      const base = path.posix.join(path.posix.dirname(from), spec)
      for (const cand of [base, `${base}.js`, `${base}.mjs`, `${base}.cjs`, `${base}/index.js`]) {
        if (contents[cand] !== undefined) return cand
      }
    }
    if (contents[spec] !== undefined) return spec
    throw new Error(`Cannot resolve '${spec}' from '${from}'`)
  }
  const requireFile = (file: string): unknown => {
    if (cache[file]) return cache[file].exports
    if (file.endsWith('.json')) {
      cache[file] = { exports: JSON.parse(contents[file]) as unknown }
      return cache[file].exports
    }
    const mod: { exports: unknown } = { exports: {} }
    cache[file] = mod
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function('module', 'exports', 'require', '__filename', '__dirname', contents[file]) as ModuleFactory
    fn(mod, mod.exports, (s: string) => requireFile(resolve(s, file)), file, path.posix.dirname(file))
    return mod.exports
  }
  return { requireFile, header, contents }
}

function assertNoEsmSyntax (contents: Record<string, string>): void {
  for (const [p, code] of Object.entries(contents)) {
    if (!/\.(js|mjs|cjs)$/.test(p)) continue
    // Definitive check: CJS-parseable (import/export are syntax errors here)
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    expect(() => new Function(code)).not.toThrow()
    expect(code).not.toMatch(/[^.\w]import\s*\(/)
  }
}

describe('convertBundleEsmToCjs against real bare-pack output', () => {
  let tempDir: string
  let projDir: string

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdk-real-bundle-'))
    projDir = path.join(tempDir, 'proj')

    // Fixture: CJS entry -> ESM package ("type": "module") -> dynamic import
    // of an .mjs file. Covers static ESM, dynamic import, and the .mjs case.
    const dep = path.join(projDir, 'node_modules/esm-dep')
    fs.mkdirSync(dep, { recursive: true })
    fs.writeFileSync(path.join(dep, 'package.json'), JSON.stringify({
      name: 'esm-dep', version: '1.0.0', type: 'module', main: 'index.js'
    }))
    fs.writeFileSync(path.join(dep, 'index.js'),
      "export async function lazy () { return (await import('./extra.mjs')).default }\n" +
      'export const value = 42\n')
    fs.writeFileSync(path.join(dep, 'extra.mjs'), "export default 'extra-loaded'\n")
    fs.writeFileSync(path.join(projDir, 'entry.js'),
      "const dep = require('esm-dep')\nmodule.exports = dep\n")
    fs.writeFileSync(path.join(projDir, 'imports.json'), '{}')
  })

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  const pack = (outName: string): string => {
    const out = path.join(projDir, outName)
    execFileSync(BARE_PACK, ['--linked', '--imports', 'imports.json', '--out', out, 'entry.js'], {
      cwd: projDir, stdio: 'pipe'
    })
    return out
  }

  const cases: Array<{ outName: string, expectedPrefix: string }> = [
    { outName: 'raw.bundle', expectedPrefix: '' },
    { outName: 'app.bundle.js', expectedPrefix: 'module.exports = ' },
    { outName: 'app.bundle.cjs', expectedPrefix: 'module.exports = ' },
    { outName: 'app.bundle.mjs', expectedPrefix: 'export default ' },
    { outName: 'app.bundle.json', expectedPrefix: '"' }
  ]

  it.each(cases)('converts $outName and the result executes CJS-only', async ({ outName, expectedPrefix }) => {
    const bundlePath = pack(outName)

    convertBundleEsmToCjs(bundlePath, { minify: true })

    const raw = fs.readFileSync(bundlePath)
    const { prefix, bundle } = unwrap(raw)
    expect(prefix).toBe(expectedPrefix)

    // Structural integrity: offsets are a cumulative sum of lengths
    const { header, dataStart } = parseRawBundle(bundle)
    const totalLen = Object.values(header.files).reduce((a, f) => a + f.length, 0)
    expect(bundle.length - dataStart).toBe(totalLen)

    const { requireFile, contents } = makeLoader(bundle)
    assertNoEsmSyntax(contents)

    // The converted graph actually runs: static export, then the lowered
    // dynamic import ((await import(...)) -> require shim) across .mjs
    const entryExports = requireFile(header.main) as { value: number, lazy: () => Promise<string> }
    expect(entryExports.value).toBe(42)
    await expect(entryExports.lazy()).resolves.toBe('extra-loaded')
  })

  it('wrapped output round-trips: unwrapped converted .bundle.js equals converted raw.bundle byte-for-byte', () => {
    const rawPath = pack('roundtrip.bundle')
    const wrappedPath = pack('roundtrip.bundle.js')

    convertBundleEsmToCjs(rawPath, { minify: true })
    convertBundleEsmToCjs(wrappedPath, { minify: true })

    const convertedRaw = fs.readFileSync(rawPath)
    const { bundle: convertedUnwrapped } = unwrap(fs.readFileSync(wrappedPath))
    expect(convertedUnwrapped.equals(convertedRaw)).toBe(true)
  })
})
