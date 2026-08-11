import fs from 'fs'
import path from 'path'
import os from 'os'
import { generateHandleLeakCheckCode } from '../../src/generators/handle-leak-check'
import type { ResolvedConfig } from '../../src/config/types'

describe('generateHandleLeakCheckCode', () => {
  let tempDir: string

  const createMockConfig = (overrides?: Partial<ResolvedConfig>): ResolvedConfig => ({
    networks: {},
    protocols: {},
    configPath: '/test/wdk.config.js',
    projectRoot: tempDir,
    resolvedOutput: {
      bundle: '/test/.wdk/wdk.bundle.js',
      types: '/test/.wdk/wdk.d.ts',
      addons: {
        ios: '/test/ios/addons',
        macos: '/test/macos/addons',
        android: '/test/android/addons'
      },
      addonsYml: '/test/addons.yml'
    },
    ...overrides
  })

  // Simulates an installed @tetherto/pear-wrk-wdk new enough to export the
  // diagnostics/handle-leak-check subpath.
  const installResolvablePearWrkWdk = (root: string): void => {
    const pkgDir = path.join(root, 'node_modules', '@tetherto', 'pear-wrk-wdk')
    fs.mkdirSync(path.join(pkgDir, 'diagnostics'), { recursive: true })
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({
        name: '@tetherto/pear-wrk-wdk',
        version: '9.9.9',
        exports: {
          './diagnostics/handle-leak-check': './diagnostics/handle-leak-check.js'
        }
      })
    )
    fs.writeFileSync(
      path.join(pkgDir, 'diagnostics', 'handle-leak-check.js'),
      'module.exports = { registerHandleLeakCheck () {} }'
    )
  }

  // Simulates an installed @tetherto/pear-wrk-wdk that predates the
  // diagnostics subpath entirely (no exports map exposing it).
  const installOldPearWrkWdk = (root: string): void => {
    const pkgDir = path.join(root, 'node_modules', '@tetherto', 'pear-wrk-wdk')
    fs.mkdirSync(pkgDir, { recursive: true })
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ name: '@tetherto/pear-wrk-wdk', version: '0.1.0', main: 'index.js' })
    )
    fs.writeFileSync(path.join(pkgDir, 'index.js'), 'module.exports = {}')
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdk-handle-leak-test-'))
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'test-project', version: '1.0.0' }))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('returns empty string when options.handleLeakCheck is not set', () => {
    const config = createMockConfig()
    expect(generateHandleLeakCheckCode(config)).toBe('')
  })

  it('returns empty string when options is set but handleLeakCheck is omitted', () => {
    const config = createMockConfig({ options: { minify: true } })
    expect(generateHandleLeakCheckCode(config)).toBe('')
  })

  it('emits the require and a bare registerHandleLeakCheck() call when enabled with true', () => {
    installResolvablePearWrkWdk(tempDir)
    const config = createMockConfig({ options: { handleLeakCheck: true } })

    const code = generateHandleLeakCheckCode(config)

    expect(code).toContain("const { registerHandleLeakCheck } = require('@tetherto/pear-wrk-wdk/diagnostics/handle-leak-check');")
    expect(code).toContain('registerHandleLeakCheck();')
  })

  it('passes a tickIntervalMs option when handleLeakCheck is a number', () => {
    installResolvablePearWrkWdk(tempDir)
    const config = createMockConfig({ options: { handleLeakCheck: 5000 } })

    const code = generateHandleLeakCheckCode(config)

    expect(code).toContain('registerHandleLeakCheck({ tickIntervalMs: 5000 });')
  })

  it('warns and skips when handleLeakCheck is set but pear-wrk-wdk is not installed at all', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const config = createMockConfig({ options: { handleLeakCheck: true } })

    const code = generateHandleLeakCheckCode(config)

    expect(code).toBe('')
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('options.handleLeakCheck is set'))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("'@tetherto/pear-wrk-wdk/diagnostics/handle-leak-check' couldn't be resolved"))
    warnSpy.mockRestore()
  })

  it('warns and skips when the installed pear-wrk-wdk predates the diagnostics subpath', () => {
    installOldPearWrkWdk(tempDir)
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const config = createMockConfig({ options: { handleLeakCheck: true } })

    const code = generateHandleLeakCheckCode(config)

    expect(code).toBe('')
    expect(warnSpy).toHaveBeenCalledTimes(1)
    warnSpy.mockRestore()
  })

  it('does not warn when handleLeakCheck is not set, even without pear-wrk-wdk installed', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const config = createMockConfig()

    generateHandleLeakCheckCode(config)

    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
