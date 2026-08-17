import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

const CLI_PATH = path.resolve(__dirname, '../../dist/cli.js')

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
      mockPackage('@tetherto/pear-wrk-wdk')

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
      mockPackage('@tetherto/pear-wrk-wdk')

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
