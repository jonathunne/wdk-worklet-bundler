import fs from 'fs'
import path from 'path'
import os from 'os'
import { generateWalletModulesCode } from '../../src/generators/wallet-modules'
import { generateModuleModulesCode } from '../../src/generators/module-modules'
import { generateEntryPoint } from '../../src/generators/entry'
import { generateJsonRpcEntryPoint } from '../../src/generators/entry-jsonrpc'
import type { ResolvedConfig } from '../../src/config/types'

describe('Code Generators', () => {
  const createMockConfig = (overrides?: Partial<ResolvedConfig>): ResolvedConfig => ({
    networks: {
      ethereum: {
        package: '@tetherto/wdk-wallet-evm-erc-4337'
      },
      polygon: {
        package: '@tetherto/wdk-wallet-evm-erc-4337'
      }
    },
    protocols: {},
    configPath: '/test/wdk.config.js',
    projectRoot: '/test',
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

  describe('generateWalletModulesCode', () => {
    it('should generate core module import', () => {
      const config = createMockConfig()
      const code = generateWalletModulesCode(config)

      expect(code).toContain("const _wdkModule = require('@tetherto/wdk', { with: { imports: 'bare-node-runtime/imports' } })")
      expect(code).toContain('WDK = _wdkModule.default || _wdkModule.WDK || _wdkModule')
    })

    it('should generate wallet module imports', () => {
      const config = createMockConfig()
      const code = generateWalletModulesCode(config)

      expect(code).toContain("if (network === 'ethereum') _mod = require('@tetherto/wdk-wallet-evm-erc-4337', { with: { imports: 'bare-node-runtime/imports' } })")
      expect(code).toContain('if (_mod) _walletCache[network] = _mod.default || _mod')
    })

    it('should map networks to wallet managers', () => {
      const config = createMockConfig()
      const code = generateWalletModulesCode(config)

      expect(code).toContain("if (network === 'ethereum') _mod = require('@tetherto/wdk-wallet-evm-erc-4337'")
      expect(code).toContain("if (network === 'polygon') _mod = require('@tetherto/wdk-wallet-evm-erc-4337'")
      expect(code).toContain("has: (_, network) => ['ethereum', 'polygon'].includes(network)")
    })

    it('should handle preload modules', () => {
      const config = createMockConfig({
        preloadModules: ['spark-frost-bare-addon']
      })
      const code = generateWalletModulesCode(config)

      expect(code).toContain("require('spark-frost-bare-addon')")
      expect(code).toContain('// Preload modules')
    })

    it('should handle multiple wallet modules', () => {
      const config = createMockConfig({
        networks: {
          ethereum: {
            package: '@tetherto/wdk-wallet-evm-erc-4337'
          },
          spark: {
            package: '@tetherto/wdk-wallet-spark'
          }
        }
      })
      const code = generateWalletModulesCode(config)

      expect(code).toContain("if (network === 'ethereum') _mod = require('@tetherto/wdk-wallet-evm-erc-4337'")
      expect(code).toContain("if (network === 'spark') _mod = require('@tetherto/wdk-wallet-spark'")
      expect(code).toContain("has: (_, network) => ['ethereum', 'spark'].includes(network)")
    })
  })

  describe('generateModuleModulesCode', () => {
    const withModules = (): ResolvedConfig => createMockConfig({
      modules: {
        addressBook: {
          package: '@tetherto/wdk-p2p-address-book',
          events: ['update']
        }
      }
    })

    it('returns a placeholder when no modules configured', () => {
      const code = generateModuleModulesCode(createMockConfig())
      expect(code).toContain('No modules configured')
    })

    it('requires the module package and builds the manager', () => {
      const code = generateModuleModulesCode(withModules())
      expect(code).toContain("const WdkP2pAddressBookRaw = require('@tetherto/wdk-p2p-address-book', { with: { imports: 'bare-node-runtime/imports' }})")
      expect(code).toContain("moduleManagers['addressBook'] = {")
    })

    it('defaults the factory to the package default export', () => {
      const code = generateModuleModulesCode(withModules())
      expect(code).toContain('createModule: (ctx) => WdkP2pAddressBook(ctx)')
    })

    it('bakes the declared events', () => {
      const code = generateModuleModulesCode(withModules())
      expect(code).toContain('events: ["update"]')
    })

    it('supports a named factory export', () => {
      const code = generateModuleModulesCode(createMockConfig({
        modules: { foo: { package: 'foo-pkg', factory: 'createModule' } }
      }))
      expect(code).toContain('createModule: (ctx) => FooPkg.createModule(ctx)')
    })

    it('stays free of any storage/corestore specifics', () => {
      const code = generateModuleModulesCode(withModules())
      expect(code).not.toContain("require('corestore'")
      expect(code).not.toContain('createStore')
      expect(code).not.toContain('state:')
    })

    // Squash the "emitted string is valid, executable JS producing the right
    // runtime shape" caveat: actually evaluate the generated code with a stubbed
    // require and assert the resulting WdkModuleManager behaves correctly.
    it('emits valid JS that executes to a correct WdkModuleManager', () => {
      const code = generateModuleModulesCode(withModules())

      const factory = jest.fn((ctx: unknown) => ({ instance: true, ctx }))
      const requireStub = (id: string): unknown => {
        if (id === '@tetherto/wdk-p2p-address-book') return factory
        throw new Error('unexpected require: ' + id)
      }

      interface GeneratedManager {
        events: string[]
        createModule: (ctx: unknown) => unknown
      }
      type Build = (require: (id: string) => unknown) => Record<string, GeneratedManager>

      // Intentionally execute the generated code to prove it is valid, runnable JS.
      // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
      const build = new Function('require', `${code}\nreturn moduleManagers;`) as unknown as Build
      const moduleManagers = build(requireStub)
      const mgr = moduleManagers.addressBook

      expect(mgr.events).toEqual(['update'])
      expect(typeof mgr.createModule).toBe('function')

      const ctx = { seed: 'SEED', config: { namespace: 'tether-wallet' }, capabilities: {}, emit: (): void => {} }
      mgr.createModule(ctx)
      expect(factory).toHaveBeenCalledWith(ctx)
    })
  })

  describe('generateEntryPoint', () => {
    let tempDir: string

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdk-entry-test-'))
    })

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true })
    })

    it('should create entry file in output directory', async () => {
      const config = createMockConfig()
      const entryPath = await generateEntryPoint(config, tempDir)

      expect(fs.existsSync(entryPath)).toBe(true)
      expect(entryPath).toBe(path.join(tempDir, 'wdk-worklet.generated.js'))
    })

    it('should include generated header comment', async () => {
      const config = createMockConfig()
      const entryPath = await generateEntryPoint(config, tempDir)
      const content = fs.readFileSync(entryPath, 'utf-8')

      expect(content).toContain('Auto-generated by @tetherto/wdk-worklet-bundler')
      expect(content).toContain('DO NOT EDIT MANUALLY')
    })

    it('should include core dependencies', async () => {
      const config = createMockConfig()
      const entryPath = await generateEntryPoint(config, tempDir)
      const content = fs.readFileSync(entryPath, 'utf-8')

      expect(content).toContain("require('bare-node-runtime/global')")
      expect(content).toContain("require('@tetherto/pear-wrk-wdk/worklet'")
    })

    it('should include RPC handlers', async () => {
      const config = createMockConfig()
      const entryPath = await generateEntryPoint(config, tempDir)
      const content = fs.readFileSync(entryPath, 'utf-8')

      expect(content).toContain('registerRpcHandlers(rpc, context)')
      expect(content).toContain('const rpc = new HRPC(BareIPC)')
    })

    it('should include wallet modules code', async () => {
      const config = createMockConfig()
      const entryPath = await generateEntryPoint(config, tempDir)
      const content = fs.readFileSync(entryPath, 'utf-8')

      expect(content).toContain("require('@tetherto/wdk'")
      expect(content).toContain("require('@tetherto/wdk-wallet-evm-erc-4337'")
    })

    it('should wire modules into context when configured', async () => {
      const config = createMockConfig({
        modules: {
          addressBook: {
            package: '@tetherto/wdk-p2p-address-book',
            events: ['update']
          }
        }
      })
      const entryPath = await generateEntryPoint(config, tempDir)
      const content = fs.readFileSync(entryPath, 'utf-8')

      expect(content).toContain("moduleManagers['addressBook'] = {")
      expect(content).toContain("require('@tetherto/wdk-p2p-address-book'")
      expect(content).toContain("moduleManagers: typeof moduleManagers !== 'undefined' ? moduleManagers : {}")
    })

    it('should default modules to an empty map when none configured', async () => {
      const config = createMockConfig()
      const entryPath = await generateEntryPoint(config, tempDir)
      const content = fs.readFileSync(entryPath, 'utf-8')

      expect(content).toContain('// No modules configured')
      expect(content).toContain("moduleManagers: typeof moduleManagers !== 'undefined' ? moduleManagers : {}")
    })

    it('should wire allowedMethods into context when configured', async () => {
      const config = createMockConfig({
        allowedMethods: {
          ethereum: {
            methods: ['getAddress', 'getBalance'],
            protocols: { swap: { uniswap: { methods: ['quoteSwap'] } } }
          }
        }
      })
      const entryPath = await generateEntryPoint(config, tempDir)
      const content = fs.readFileSync(entryPath, 'utf-8')

      expect(content).toContain('allowedMethods: {"ethereum":{"methods":["getAddress","getBalance"],"protocols":{"swap":{"uniswap":{"methods":["quoteSwap"]}}}}}')
    })

    it('should default allowedMethods to an empty map when none configured', async () => {
      const config = createMockConfig()
      const entryPath = await generateEntryPoint(config, tempDir)
      const content = fs.readFileSync(entryPath, 'utf-8')

      expect(content).toContain('allowedMethods: {}')
    })

    it('should wire allowedModuleMethods into context when configured', async () => {
      const config = createMockConfig({
        allowedModuleMethods: {
          addressBook: { methods: ['list', 'add'] }
        }
      })
      const entryPath = await generateEntryPoint(config, tempDir)
      const content = fs.readFileSync(entryPath, 'utf-8')

      expect(content).toContain('allowedModuleMethods: {"addressBook":{"methods":["list","add"]}}')
    })

    it('should default allowedModuleMethods to an empty map when none configured', async () => {
      const config = createMockConfig()
      const entryPath = await generateEntryPoint(config, tempDir)
      const content = fs.readFileSync(entryPath, 'utf-8')

      expect(content).toContain('allowedModuleMethods: {}')
    })

    it('should create output directory if it does not exist', async () => {
      const config = createMockConfig()
      const nestedDir = path.join(tempDir, 'nested', 'output')

      const entryPath = await generateEntryPoint(config, nestedDir)

      expect(fs.existsSync(nestedDir)).toBe(true)
      expect(fs.existsSync(entryPath)).toBe(true)
    })

    describe('options.handleLeakCheck', () => {
      it('should emit no trace of the handle-leak diagnostic when unset', async () => {
        const config = createMockConfig()
        const entryPath = await generateEntryPoint(config, tempDir)
        const content = fs.readFileSync(entryPath, 'utf-8')

        expect(content).not.toContain('registerHandleLeakCheck')
        expect(content).not.toContain('diagnostics/handle-leak-check')
        expect(content).toContain("const { HRPC, registerRpcHandlers, utils } = require('@tetherto/pear-wrk-wdk/worklet'")
      })

      it('should include the require and registerHandleLeakCheck() call when enabled and resolvable', async () => {
        const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wdk-entry-handle-leak-proj-'))
        const pkgDir = path.join(projectRoot, 'node_modules/@tetherto/pear-wrk-wdk')
        fs.mkdirSync(path.join(pkgDir, 'diagnostics'), { recursive: true })
        fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({
          name: '@tetherto/pear-wrk-wdk',
          version: '9.9.9',
          exports: { './diagnostics/handle-leak-check': './diagnostics/handle-leak-check.js' }
        }))
        fs.writeFileSync(
          path.join(pkgDir, 'diagnostics/handle-leak-check.js'),
          'module.exports = { registerHandleLeakCheck () {} }'
        )

        try {
          const config = createMockConfig({ projectRoot, options: { handleLeakCheck: 5000 } })
          const entryPath = await generateEntryPoint(config, tempDir)
          const content = fs.readFileSync(entryPath, 'utf-8')

          expect(content).toContain("const { registerHandleLeakCheck } = require('@tetherto/pear-wrk-wdk/diagnostics/handle-leak-check');")
          expect(content).toContain('registerHandleLeakCheck({ tickIntervalMs: 5000 });')
        } finally {
          fs.rmSync(projectRoot, { recursive: true, force: true })
        }
      })

      it('should warn and omit the diagnostic when enabled but unresolvable, without failing generation', async () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
        const config = createMockConfig({ options: { handleLeakCheck: true } })

        const entryPath = await generateEntryPoint(config, tempDir)
        const content = fs.readFileSync(entryPath, 'utf-8')

        expect(content).not.toContain('registerHandleLeakCheck')
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('options.handleLeakCheck is set'))
        warnSpy.mockRestore()
      })
    })
  })

  describe('generateJsonRpcEntryPoint', () => {
    let tempDir: string

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdk-jsonrpc-entry-test-'))
    })

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true })
    })

    it('wires modules and their allowlist into the JSON-RPC context', async () => {
      const config = createMockConfig({
        transport: 'jsonrpc',
        modules: {
          addressBook: {
            package: '@tetherto/wdk-p2p-address-book',
            factory: 'createWorkletModule',
            events: ['update']
          }
        },
        allowedModuleMethods: {
          addressBook: { methods: ['list', 'add'] }
        }
      })

      const entryPath = await generateJsonRpcEntryPoint(config, tempDir)
      const content = fs.readFileSync(entryPath, 'utf-8')

      expect(content).toContain('// Transport: jsonrpc')
      expect(content).toContain("require('@tetherto/wdk-p2p-address-book'")
      expect(content).toContain("moduleManagers['addressBook'] = {")
      expect(content).toContain('moduleManagers: typeof moduleManagers !== \'undefined\' ? moduleManagers : {}')
      expect(content).toContain('allowedModuleMethods: {"addressBook":{"methods":["list","add"]}}')
      expect(content).toContain('registerJsonRpcHandlers(BareIPC, context)')
      expect(content).toContain('context.moduleRuntime.suspendAll()')
      expect(content).toContain('context.moduleRuntime.resumeAll()')
    })

    it('defaults modules and their allowlist to empty maps', async () => {
      const entryPath = await generateJsonRpcEntryPoint(createMockConfig({ transport: 'jsonrpc' }), tempDir)
      const content = fs.readFileSync(entryPath, 'utf-8')

      expect(content).toContain('// No modules configured')
      expect(content).toContain("moduleManagers: typeof moduleManagers !== 'undefined' ? moduleManagers : {}")
      expect(content).toContain('allowedModuleMethods: {}')
    })
  })
})
