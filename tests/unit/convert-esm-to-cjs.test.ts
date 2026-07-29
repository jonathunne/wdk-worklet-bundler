import fs from 'fs'
import path from 'path'
import os from 'os'
import { convertBundleEsmToCjs } from '../../src/bundler/convert-esm-to-cjs'

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
})
