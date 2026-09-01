/**
 * Integration test: prove the actual bare-pack payoff behind
 * generateHandleLeakCheckCode's opt-in design - when options.handleLeakCheck
 * is unset, no require for the diagnostic is emitted, so bare-pack never
 * pulls it (or the bare-walk-handles dependency it drags in) into the
 * packed bundle at all. When it's set, both show up.
 *
 * Uses the real bare-pack binary against a fixture @tetherto/pear-wrk-wdk
 * (its diagnostics/handle-leak-check subpath requires bare-walk-handles,
 * mirroring the real package), so this is exercised through actual
 * dependency resolution rather than a reimplementation of bare-pack.
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { execFileSync } from 'child_process'
import { generateHandleLeakCheckCode } from '../../src/generators/handle-leak-check'
import type { ResolvedConfig } from '../../src/config/types'

const BARE_PACK = path.join(__dirname, '../../node_modules/.bin/bare-pack')

interface Header { files: Record<string, unknown> }

function parseBundleFiles (bundlePath: string): string[] {
  const buf = fs.readFileSync(bundlePath)
  const nl = buf.indexOf(0x0a)
  const N = parseInt(buf.subarray(0, nl).toString(), 10)
  const headerStart = nl + 1
  const jsonEnd = headerStart + N - 2
  const header = JSON.parse(buf.subarray(headerStart, jsonEnd).toString()) as Header
  return Object.keys(header.files)
}

describe('generateHandleLeakCheckCode against real bare-pack output', () => {
  let tempDir: string
  let projDir: string

  const createMockConfig = (overrides?: Partial<ResolvedConfig>): ResolvedConfig => ({
    networks: {},
    protocols: {},
    configPath: path.join(projDir, 'wdk.config.js'),
    projectRoot: projDir,
    resolvedOutput: {
      bundle: path.join(projDir, '.wdk/wdk.bundle.js'),
      types: path.join(projDir, '.wdk/wdk.d.ts'),
      addons: { ios: '', macos: '', android: '' },
      addonsYml: ''
    },
    ...overrides
  })

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdk-handle-leak-bundle-'))
    projDir = path.join(tempDir, 'proj')

    // Fixture @tetherto/pear-wrk-wdk whose diagnostics/handle-leak-check
    // subpath requires bare-walk-handles - the dependency bare-pack should
    // only pull in when the diagnostic is actually required.
    const pkgDir = path.join(projDir, 'node_modules/@tetherto/pear-wrk-wdk')
    fs.mkdirSync(path.join(pkgDir, 'diagnostics'), { recursive: true })
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({
      name: '@tetherto/pear-wrk-wdk',
      version: '9.9.9',
      exports: { './diagnostics/handle-leak-check': './diagnostics/handle-leak-check.js' }
    }))
    fs.writeFileSync(path.join(pkgDir, 'diagnostics/handle-leak-check.js'),
      "const { walkHandles } = require('bare-walk-handles')\n" +
      'module.exports = { registerHandleLeakCheck (opts) { return walkHandles } }\n')

    const walkHandlesDir = path.join(projDir, 'node_modules/bare-walk-handles')
    fs.mkdirSync(walkHandlesDir, { recursive: true })
    fs.writeFileSync(path.join(walkHandlesDir, 'package.json'),
      JSON.stringify({ name: 'bare-walk-handles', version: '1.0.0', main: 'index.js' }))
    fs.writeFileSync(path.join(walkHandlesDir, 'index.js'), 'module.exports = { walkHandles () { return [] } }\n')

    fs.writeFileSync(path.join(projDir, 'package.json'), JSON.stringify({ name: 'fixture-proj', version: '1.0.0' }))
    fs.writeFileSync(path.join(projDir, 'imports.json'), '{}')
  })

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  const pack = (entryName: string, generatedCode: string, outName: string): string => {
    fs.writeFileSync(path.join(projDir, entryName), `${generatedCode}\nmodule.exports = { ok: true }\n`)
    const out = path.join(projDir, outName)
    execFileSync(BARE_PACK, ['--linked', '--imports', 'imports.json', '--out', out, entryName], {
      cwd: projDir, stdio: 'pipe'
    })
    return out
  }

  it('keeps bare-walk-handles and pear-wrk-wdk out of the bundle when handleLeakCheck is unset', () => {
    const code = generateHandleLeakCheckCode(createMockConfig())
    expect(code).toBe('')

    const bundlePath = pack('entry-off.js', code, 'off.bundle')
    const files = parseBundleFiles(bundlePath)

    expect(files.some(f => f.includes('bare-walk-handles'))).toBe(false)
    expect(files.some(f => f.includes('pear-wrk-wdk'))).toBe(false)
  })

  it('pulls bare-walk-handles and the diagnostic into the bundle when handleLeakCheck is enabled', () => {
    const code = generateHandleLeakCheckCode(createMockConfig({ options: { handleLeakCheck: true } }))
    expect(code).toContain('registerHandleLeakCheck')

    const bundlePath = pack('entry-on.js', code, 'on.bundle')
    const files = parseBundleFiles(bundlePath)

    expect(files.some(f => f.includes('bare-walk-handles'))).toBe(true)
    expect(files.some(f => f.endsWith('diagnostics/handle-leak-check.js'))).toBe(true)
  })
})
