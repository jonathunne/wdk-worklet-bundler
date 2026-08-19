import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

const CLI_PATH = path.resolve(__dirname, '../../dist/cli.js')
const BARE_PACK_MODULE = path.resolve(__dirname, '../../node_modules/bare-pack')

describe('CLI Integration Tests', () => {
  let tempDir: string
  let originalCwd: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdk-cli-test-'))
    originalCwd = process.cwd()
    process.chdir(tempDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  const runCli = (args: string): string => {
    try {
      return execSync(`node ${CLI_PATH} ${args} 2>&1`, {
        encoding: 'utf-8',
        cwd: tempDir
      })
    } catch (error: unknown) {
      const execError = error as { stdout?: string, stderr?: string, message?: string }
      return execError.stdout || execError.stderr || execError.message || ''
    }
  }

  const mockPackage = (name: string): void => {
    const pkgPath = path.join(tempDir, 'node_modules', name)
    fs.mkdirSync(pkgPath, { recursive: true })
    fs.writeFileSync(
      path.join(pkgPath, 'package.json'),
      JSON.stringify({ name, version: '1.0.0' })
    )
  }

  const mockPackageFiles = (name: string, files: Record<string, string>): void => {
    mockPackage(name)
    const pkgPath = path.join(tempDir, 'node_modules', name)
    for (const [filename, source] of Object.entries(files)) {
      const filepath = path.join(pkgPath, filename)
      fs.mkdirSync(path.dirname(filepath), { recursive: true })
      fs.writeFileSync(filepath, source)
    }
  }

  describe('init command', () => {
    it('should create wdk.config.js with default config', () => {
      const output = runCli('init -y')

      expect(output).toContain('Created wdk.config.js')
      expect(fs.existsSync(path.join(tempDir, 'wdk.config.js'))).toBe(true)
    })

    it('should create config with proper structure', () => {
      runCli('init -y')

      const configPath = path.join(tempDir, 'wdk.config.js')
      const content = fs.readFileSync(configPath, 'utf-8')

      expect(content).toContain('networks:')
      expect(content).toContain('package:')
      expect(content).toContain('@tetherto/wdk')
    })

    it('should warn if config already exists', () => {
      runCli('init -y')
      const output = runCli('init')
      expect(output).toContain('already exists')
    })

    it('should overwrite with -y flag', () => {
      runCli('init -y')
      fs.appendFileSync(path.join(tempDir, 'wdk.config.js'), '// modified')
      runCli('init -y')
      const content = fs.readFileSync(path.join(tempDir, 'wdk.config.js'), 'utf-8')
      expect(content).not.toContain('// modified')
    })
  })

  describe('validate command', () => {
    it('should validate valid config', () => {
      const config = `
module.exports = {
  networks: {
    ethereum: {
      package: '@tetherto/wdk-wallet-evm-erc-4337',
    },
  },
};
`
      fs.writeFileSync(path.join(tempDir, 'wdk.config.js'), config)

      mockPackage('@tetherto/wdk-wallet-evm-erc-4337')
      mockPackage('@tetherto/wdk')
      mockPackage('bare-node-runtime')

      const output = runCli('validate')

      expect(output).toContain('Config file valid')
    })

    it('should fail on missing dependencies', () => {
      const config = `
module.exports = {
  networks: {
    ethereum: {
      package: '@tetherto/wdk-wallet-evm-erc-4337',
    },
  },
};
`
      fs.writeFileSync(path.join(tempDir, 'wdk.config.js'), config)

      const output = runCli('validate')

      expect(output).toContain('NOT INSTALLED')
    })

    it('should fail on invalid config', () => {
      const config = `
module.exports = {
  networks: {},
};
`
      fs.writeFileSync(path.join(tempDir, 'wdk.config.js'), config)

      const output = runCli('validate')

      expect(output).toContain('Invalid configuration')
    })

    it('should error when no config file exists', () => {
      const output = runCli('validate')
      expect(output).toContain('No wdk.config.js found')
    })
  })

  describe('generate command', () => {
    it('should fail when config is missing', () => {
      const output = runCli('generate')
      expect(output).toContain('No wdk.config.js found')
    })

    it('should produce a jsonrpc bundle containing configured modules', () => {
      const config = `
module.exports = {
  transport: 'jsonrpc',
  networks: { ethereum: { package: '@tetherto/wdk-wallet-evm' } },
  modules: {
    addressBook: {
      package: '@tetherto/wdk-p2p-address-book',
      factory: 'createWorkletModule',
      events: ['update'],
    },
  },
  allowedModuleMethods: { addressBook: { methods: ['list'] } },
  output: { bundle: './out/wdk.bundle' },
};
`
      fs.writeFileSync(path.join(tempDir, 'wdk.config.js'), config)

      mockPackageFiles('@tetherto/wdk', {
        'index.js': 'module.exports = class WDK {}\n'
      })
      mockPackageFiles('bare-node-runtime', {
        'global.js': 'module.exports = {}\n',
        'imports.json': '{}\n'
      })
      mockPackageFiles('@tetherto/wdk-wallet-evm', {
        'index.js': 'module.exports = class WalletManager {}\n'
      })
      mockPackageFiles('@tetherto/wdk-p2p-address-book', {
        'index.js': 'exports.createWorkletModule = (ctx) => ({ ctx, list: () => [] })\n'
      })
      mockPackageFiles('@tetherto/pear-wrk-wdk', {
        'jsonrpc.js': `
exports.registerJsonRpcHandlers = () => {};
exports.utils = { logger: { info: () => {}, error: () => {} } };
`
      })

      // generateBundle runs `npx --no-install bare-pack` from the fixture
      // project, so expose this repo's already-installed test dependency there.
      fs.symlinkSync(BARE_PACK_MODULE, path.join(tempDir, 'node_modules', 'bare-pack'), 'dir')
      const binDir = path.join(tempDir, 'node_modules', '.bin')
      fs.mkdirSync(binDir, { recursive: true })
      fs.symlinkSync('../bare-pack/bin.js', path.join(binDir, 'bare-pack'))

      const output = runCli('generate --skip-link-addons --keep-artifacts --no-types')
      const entry = fs.readFileSync(path.join(tempDir, '.wdk', 'wdk-worklet.generated.js'), 'utf-8')
      const bundlePath = path.join(tempDir, 'out', 'wdk.bundle')

      expect(output).toContain('Bundle generated successfully')
      expect(entry).toContain("require('@tetherto/wdk-p2p-address-book'")
      expect(entry).toContain("moduleManagers['addressBook'] = {")
      expect(entry).toContain('moduleManagers: typeof moduleManagers')
      expect(entry).toContain('allowedModuleMethods: {"addressBook":{"methods":["list"]}}')
      expect(fs.existsSync(bundlePath)).toBe(true)
      expect(fs.statSync(bundlePath).size).toBeGreaterThan(0)
      expect(fs.readFileSync(bundlePath).includes(Buffer.from('addressBook'))).toBe(true)
    })

    it('should fail when dependencies are missing', () => {
      const config = `
module.exports = {
  networks: {
    ethereum: {
      package: '@tetherto/wdk-wallet-evm-erc-4337',
    },
  },
};
`
      fs.writeFileSync(path.join(tempDir, 'wdk.config.js'), config)

      const output = runCli('generate')

      expect(output).toContain('Missing core dependencies')
    })

    it('should attempt install with --install flag', () => {
      const config = `
module.exports = {
  networks: {
    ethereum: {
      package: '@tetherto/wdk-wallet-evm-erc-4337',
    },
  },
};
`
      fs.writeFileSync(path.join(tempDir, 'wdk.config.js'), config)
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'test-project', version: '1.0.0' })
      )

      const output = runCli('generate --install')
      expect(output).toContain('Installing missing dependencies')
    })

    it('should warn about local paths that cannot be auto-installed', () => {
      const config = `
module.exports = {
  networks: {
    ethereum: {
      package: './local-wdk-module',
    },
  },
};
`
      fs.writeFileSync(path.join(tempDir, 'wdk.config.js'), config)
      mockPackage('@tetherto/wdk')
      mockPackage('bare-node-runtime')

      const output = runCli('generate --install')

      expect(output).toContain('Failed to install')
    })

    it('should show dry run output', () => {
      const config = `
module.exports = {
  networks: {
    ethereum: {
      package: '@tetherto/wdk-wallet-evm-erc-4337',
    },
  },
};
`
      fs.writeFileSync(path.join(tempDir, 'wdk.config.js'), config)

      mockPackage('@tetherto/wdk-wallet-evm-erc-4337')
      mockPackage('@tetherto/wdk')
      mockPackage('bare-node-runtime')

      const output = runCli('generate --dry-run')

      expect(output).toContain('Dry run')
      expect(output).toContain('.wdk/wdk-worklet.generated.js')
    })
  })

  describe('custom config path', () => {
    it('should use custom config path with -c flag', () => {
      const customConfigPath = path.join(tempDir, 'custom', 'my-config.js')
      fs.mkdirSync(path.dirname(customConfigPath), { recursive: true })

      const config = `
module.exports = {
  networks: {
    ethereum: {
      package: '@tetherto/wdk-wallet-evm-erc-4337',
    },
  },
};
`
      fs.writeFileSync(customConfigPath, config)

      mockPackage('@tetherto/wdk-wallet-evm-erc-4337')
      mockPackage('@tetherto/wdk')
      mockPackage('bare-node-runtime')

      const output = runCli('validate -c custom/my-config.js')

      expect(output).toContain('custom/my-config.js')
    })

    it('should error on non-existent config path', () => {
      const output = runCli('validate -c nonexistent.js')
      expect(output).toContain('Config file not found')
    })
  })
})
