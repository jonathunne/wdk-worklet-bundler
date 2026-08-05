import fs from 'fs'
import path from 'path'
import os from 'os'
import { convertBundleEsmToCjs, validateBundle } from '../../src/bundler/bare-bundle-esm-to-cjs'

/** Build a bare-pack style bundle: <N>\n<JSON>\n<DATA> */
function createBundle (files: Record<string, string>): Buffer {
  const buffers: Buffer[] = []
  const fileMap: Record<string, { offset: number, length: number }> = {}
  let offset = 0

  for (const [filePath, content] of Object.entries(files)) {
    const buf = Buffer.from(content)
    fileMap[filePath] = { offset, length: buf.length }
    offset += buf.length
    buffers.push(buf)
  }

  const json = JSON.stringify({ files: fileMap })
  const N = json.length + 2
  return Buffer.concat([
    Buffer.from(N.toString() + '\n'),
    Buffer.from(json),
    Buffer.from('\n'),
    ...buffers
  ])
}

/** Parse a bundle back into per-file contents (mirrors the bundle format) */
function readBundleFiles (bundlePath: string): Record<string, string> {
  const buf = fs.readFileSync(bundlePath)
  const nl = buf.indexOf(0x0a)
  const N = parseInt(buf.subarray(0, nl).toString(), 10)
  const headerStart = nl + 1
  const jsonEnd = headerStart + N - 2
  const header = JSON.parse(buf.subarray(headerStart, jsonEnd).toString()) as {
    files: Record<string, { offset: number, length: number }>
  }
  const dataStart = jsonEnd + 1

  const out: Record<string, string> = {}
  for (const [filePath, info] of Object.entries(header.files)) {
    out[filePath] = buf.subarray(dataStart + info.offset, dataStart + info.offset + info.length).toString()
  }
  return out
}

describe('convertBundleEsmToCjs', () => {
  let tempDir: string
  let bundlePath: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdk-convert-test-'))
    bundlePath = path.join(tempDir, 'test.bundle.js')
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  const convert = (files: Record<string, string>): Record<string, string> => {
    fs.writeFileSync(bundlePath, createBundle(files))
    convertBundleEsmToCjs(bundlePath, { minify: false })
    return readBundleFiles(bundlePath)
  }

  it('converts static import/export to CJS', () => {
    const result = convert({
      '/node_modules/pkg/index.js': "import dep from 'dep'\nexport const x = dep"
    })
    const code = result['/node_modules/pkg/index.js']
    expect(code).toContain('require("dep")')
    expect(code).not.toMatch(/^import /m)
    expect(code).not.toMatch(/^export /m)
  })

  it('rewrites dynamic import() to a require-based shim', () => {
    const result = convert({
      '/node_modules/pkg/ws.js': "export async function connect () { const WebSocket = (await import('ws')).default; return WebSocket }"
    })
    const code = result['/node_modules/pkg/ws.js']
    expect(code).not.toContain('import(')
    expect(code).toContain('require("ws")')
    // Async shape preserved: still awaitable via a promise wrapper
    expect(code).toContain('Promise.resolve()')
  })

  it('rewrites dynamic import() with non-literal specifiers', () => {
    const result = convert({
      '/node_modules/pkg/lazy.mjs': 'export const load = (m) => import(m)'
    })
    const code = result['/node_modules/pkg/lazy.mjs']
    expect(code).not.toContain('import(')
    expect(code).toContain('require(m)')
  })

  it('removes "type": "module" from package.json', () => {
    const result = convert({
      '/node_modules/pkg/package.json': JSON.stringify({ name: 'pkg', type: 'module' }),
      '/node_modules/pkg/index.js': 'export default 1'
    })
    const pkg = JSON.parse(result['/node_modules/pkg/package.json']) as { name?: string, type?: string }
    expect(pkg.type).toBeUndefined()
    expect(pkg.name).toBe('pkg')
  })

  it('keeps the offset table consistent after content lengths change', () => {
    const files = {
      '/a.js': "import x from 'x'\nexport const a = x",
      '/b.js': "export async function b () { return (await import('y')).default }",
      '/c.js': "module.exports = 'plain cjs'"
    }
    const result = convert(files)

    // Every file readable back through its recomputed offset/length
    expect(result['/c.js']).toContain('plain cjs')
    expect(result['/a.js']).toContain('require("x")')
    expect(result['/b.js']).toContain('require("y")')
  })

  it('throws when a file cannot be converted', () => {
    fs.writeFileSync(bundlePath, createBundle({
      '/broken.js': 'export const = = syntax error {'
    }))
    expect(() => convertBundleEsmToCjs(bundlePath, { minify: false })).toThrow(/conversion failed/)
  })

  describe('bare-pack JS-wrapped bundles (.bundle.js / .bundle.mjs)', () => {
    // bare-pack wraps the raw bundle for JS-importable outputs; the converter
    // must reverse the wrapper, convert, and restore it byte-for-byte.
    const wrapCjs = (raw: Buffer): Buffer =>
      Buffer.from(`module.exports = ${JSON.stringify(raw.toString('utf8'))}\n`)
    const wrapMjs = (raw: Buffer): Buffer =>
      Buffer.from(`export default ${JSON.stringify(raw.toString('utf8'))}\n`)

    const readWrappedFiles = (): Record<string, string> => {
      const wrapped = fs.readFileSync(bundlePath, 'utf8')
      const prefix = wrapped.startsWith('module.exports = ') ? 'module.exports = ' : 'export default '
      const raw = JSON.parse(wrapped.slice(prefix.length)) as string
      const rawPath = path.join(tempDir, 'unwrapped.bundle')
      fs.writeFileSync(rawPath, raw)
      return readBundleFiles(rawPath)
    }

    it('converts a module.exports-wrapped bundle and keeps the wrapper', () => {
      fs.writeFileSync(bundlePath, wrapCjs(createBundle({
        '/node_modules/pkg/index.js': "import dep from 'dep'\nexport const x = dep"
      })))

      convertBundleEsmToCjs(bundlePath, { minify: false })

      const wrapped = fs.readFileSync(bundlePath, 'utf8')
      expect(wrapped.startsWith('module.exports = ')).toBe(true)
      expect(wrapped.endsWith('\n')).toBe(true)
      const code = readWrappedFiles()['/node_modules/pkg/index.js']
      expect(code).toContain('require("dep")')
      expect(code).not.toMatch(/^import /m)
    })

    it('converts an export default-wrapped bundle and keeps the wrapper', () => {
      fs.writeFileSync(bundlePath, wrapMjs(createBundle({
        '/node_modules/pkg/ws.mjs': "export async function connect () { return (await import('ws')).default }"
      })))

      convertBundleEsmToCjs(bundlePath, { minify: false })

      const wrapped = fs.readFileSync(bundlePath, 'utf8')
      expect(wrapped.startsWith('export default ')).toBe(true)
      const code = readWrappedFiles()['/node_modules/pkg/ws.mjs']
      expect(code).not.toContain('import(')
      expect(code).toContain('require("ws")')
    })

    it('re-wrapped bundle round-trips back to a valid raw bundle', () => {
      fs.writeFileSync(bundlePath, wrapCjs(createBundle({
        '/a.js': "import x from 'x'\nexport const a = x",
        '/b.json': JSON.stringify({ nested: { works: true } })
      })))

      convertBundleEsmToCjs(bundlePath, { minify: false })

      const files = readWrappedFiles()
      expect(files['/a.js']).toContain('require("x")')
      expect(JSON.parse(files['/b.json'])).toEqual({ nested: { works: true } })
    })
  })

  describe('validateBundle', () => {
    const writeBundle = (files: Record<string, string>, mutate?: (bundle: Buffer) => Buffer): void => {
      let bundle = createBundle(files)
      if (mutate) bundle = mutate(bundle)
      fs.writeFileSync(bundlePath, bundle)
    }

    it('passes on a converted bundle (and runs automatically after conversion)', () => {
      writeBundle({
        '/node_modules/pkg/index.js': "import dep from 'dep'\nexport const x = dep"
      })
      // convertBundleEsmToCjs calls validateBundle internally — not throwing IS the assertion
      expect(() => convertBundleEsmToCjs(bundlePath, { minify: false })).not.toThrow()
      expect(() => validateBundle(bundlePath)).not.toThrow()
    })

    it('rejects files that are not valid CJS (unconverted ESM)', () => {
      writeBundle({ '/a.js': 'export const x = 1' })
      expect(() => validateBundle(bundlePath)).toThrow(/not valid CJS/)
    })

    it('rejects surviving dynamic import()', () => {
      // import(x) is parseable inside a CJS wrapper, so the syntax check
      // alone would miss it — the token scan must catch it
      writeBundle({ '/a.js': 'module.exports = () => import("x")' })
      expect(() => validateBundle(bundlePath)).toThrow(/dynamic import/)
    })

    it('rejects package.json still declaring "type": "module"', () => {
      writeBundle({
        '/node_modules/pkg/package.json': JSON.stringify({ name: 'pkg', type: 'module' }),
        '/node_modules/pkg/index.js': 'module.exports = 1'
      })
      expect(() => validateBundle(bundlePath)).toThrow(/"type": "module"/)
    })

    it('rejects data length drift (offsets not matching content)', () => {
      // Simulates the hand-edit failure mode: content bytes change but the
      // header offsets/lengths are not recomputed
      writeBundle({ '/a.js': 'module.exports = 1', '/b.js': 'module.exports = 2' },
        bundle => Buffer.concat([bundle, Buffer.from('EXTRA')]))
      expect(() => validateBundle(bundlePath)).toThrow(/data length mismatch/)
    })

    it('rejects a main missing from the file map', () => {
      const files = { '/a.js': 'module.exports = 1' }
      const fileMap: Record<string, { offset: number, length: number }> = {}
      const buf = Buffer.from(files['/a.js'])
      fileMap['/a.js'] = { offset: 0, length: buf.length }
      const json = JSON.stringify({ main: '/missing.js', files: fileMap })
      fs.writeFileSync(bundlePath, Buffer.concat([
        Buffer.from(`${json.length + 2}\n`), Buffer.from(json), Buffer.from('\n'), buf
      ]))
      expect(() => validateBundle(bundlePath)).toThrow(/main '\/missing\.js'/)
    })

    it('validates wrapped bundles through the wrapper', () => {
      const wrapped = Buffer.from(`module.exports = ${JSON.stringify(createBundle({ '/a.js': 'export default 1' }).toString('utf8'))}\n`)
      fs.writeFileSync(bundlePath, wrapped)
      expect(() => validateBundle(bundlePath)).toThrow(/not valid CJS/)
    })
  })
})
