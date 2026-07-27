import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  resolveModule,
  validateDependencies,
  detectPackageManager,
  generateInstallCommand,
  generateUninstallCommand,
  installDependencies,
  uninstallDependencies,
  checkOptionalPeerDependencies,
  findMissingRequiredPeers,
  findMissingOptionalPeers,
  scanPeerDependencies,
  collectInstalledPackages
} from '../../src/validators/dependencies'

describe('Dependency Validator', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdk-test-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  describe('resolveModule', () => {
    it('should resolve installed npm module', () => {
      const modulePath = path.join(tempDir, 'node_modules', '@tetherto', 'wdk')
      fs.mkdirSync(modulePath, { recursive: true })
      fs.writeFileSync(
        path.join(modulePath, 'package.json'),
        JSON.stringify({ name: '@tetherto/wdk', version: '1.0.0' })
      )

      const result = resolveModule('@tetherto/wdk', tempDir)

      expect(result).not.toBeNull()
      expect(result?.name).toBe('@tetherto/wdk')
      expect(result?.version).toBe('1.0.0')
      expect(result?.isLocal).toBe(false)
    })

    it('should return null for missing npm module', () => {
      const result = resolveModule('@tetherto/nonexistent', tempDir)
      expect(result).toBeNull()
    })

    it('should resolve local module path', () => {
      const localModule = path.join(tempDir, 'local-module')
      fs.mkdirSync(localModule, { recursive: true })
      fs.writeFileSync(
        path.join(localModule, 'package.json'),
        JSON.stringify({ name: 'my-local-module', version: '0.1.0' })
      )

      const result = resolveModule('./local-module', tempDir)

      expect(result).not.toBeNull()
      expect(result?.name).toBe('my-local-module')
      expect(result?.version).toBe('0.1.0')
      expect(result?.isLocal).toBe(true)
    })

    it('should resolve local module without package.json', () => {
      const localModule = path.join(tempDir, 'simple-module')
      fs.mkdirSync(localModule, { recursive: true })
      fs.writeFileSync(path.join(localModule, 'index.js'), 'module.exports = {}')

      const result = resolveModule('./simple-module', tempDir)

      expect(result).not.toBeNull()
      expect(result?.name).toBe('simple-module')
      expect(result?.version).toBe('local')
      expect(result?.isLocal).toBe(true)
    })

    it('should return null for missing local module', () => {
      const result = resolveModule('./nonexistent', tempDir)
      expect(result).toBeNull()
    })

    it('should handle absolute paths', () => {
      const absoluteModule = path.join(tempDir, 'absolute-module')
      fs.mkdirSync(absoluteModule, { recursive: true })
      fs.writeFileSync(
        path.join(absoluteModule, 'package.json'),
        JSON.stringify({ name: 'absolute-mod', version: '2.0.0' })
      )

      const result = resolveModule(absoluteModule, tempDir)

      expect(result).not.toBeNull()
      expect(result?.name).toBe('absolute-mod')
      expect(result?.isLocal).toBe(true)
    })
  })

  describe('validateDependencies', () => {
    it('should return valid when all modules are installed', () => {
      const wdkPath = path.join(tempDir, 'node_modules', '@tetherto', 'wdk')
      const erc4337Path = path.join(tempDir, 'node_modules', '@tetherto', 'wdk-wallet-evm-erc-4337')

      fs.mkdirSync(wdkPath, { recursive: true })
      fs.mkdirSync(erc4337Path, { recursive: true })

      fs.writeFileSync(
        path.join(wdkPath, 'package.json'),
        JSON.stringify({ name: '@tetherto/wdk', version: '1.0.0' })
      )
      fs.writeFileSync(
        path.join(erc4337Path, 'package.json'),
        JSON.stringify({ name: '@tetherto/wdk-wallet-evm-erc-4337', version: '1.0.0' })
      )

      const modules = {
        core: '@tetherto/wdk',
        erc4337: '@tetherto/wdk-wallet-evm-erc-4337'
      }

      const result = validateDependencies(Object.values(modules), tempDir)

      expect(result.valid).toBe(true)
      expect(result.installed).toHaveLength(2)
      expect(result.missing).toHaveLength(0)
    })

    it('should return invalid when modules are missing', () => {
      const modules = {
        core: '@tetherto/wdk',
        erc4337: '@tetherto/wdk-wallet-evm-erc-4337'
      }

      const result = validateDependencies(Object.values(modules), tempDir)

      expect(result.valid).toBe(false)
      expect(result.installed).toHaveLength(0)
      expect(result.missing).toContain('@tetherto/wdk')
      expect(result.missing).toContain('@tetherto/wdk-wallet-evm-erc-4337')
    })

    it('should handle mixed installed and missing modules', () => {
      const wdkPath = path.join(tempDir, 'node_modules', '@tetherto', 'wdk')
      fs.mkdirSync(wdkPath, { recursive: true })
      fs.writeFileSync(
        path.join(wdkPath, 'package.json'),
        JSON.stringify({ name: '@tetherto/wdk', version: '1.0.0' })
      )

      const modules = {
        core: '@tetherto/wdk',
        erc4337: '@tetherto/wdk-wallet-evm-erc-4337'
      }

      const result = validateDependencies(Object.values(modules), tempDir)

      expect(result.valid).toBe(false)
      expect(result.installed).toHaveLength(1)
      expect(result.missing).toContain('@tetherto/wdk-wallet-evm-erc-4337')
    })
  })

  describe('checkOptionalPeerDependencies', () => {
    const writeModule = (name: string, pkg: Record<string, unknown>): string => {
      const modulePath = path.join(tempDir, 'node_modules', ...name.split('/'))
      fs.mkdirSync(modulePath, { recursive: true })
      fs.writeFileSync(
        path.join(modulePath, 'package.json'),
        JSON.stringify({ name, version: '1.0.0', ...pkg })
      )
      return modulePath
    }

    it('should report missing peers not marked as optional', () => {
      const modulePath = writeModule('@tetherto/wdk-wallet-btc', {
        peerDependencies: { 'some-required-peer': '^1.0.0' }
      })

      const missing = checkOptionalPeerDependencies(
        [{ name: '@tetherto/wdk-wallet-btc', path: modulePath, version: '1.0.0', isLocal: false }],
        tempDir
      )

      expect(missing).toHaveLength(1)
      expect(missing[0].name).toBe('some-required-peer')
      expect(missing[0].sources[0].parent).toBe('@tetherto/wdk-wallet-btc')
    })

    it('should skip peers marked optional via peerDependenciesMeta', () => {
      const modulePath = writeModule('@bitcoinerlab/descriptors', {
        peerDependencies: { '@ledgerhq/ledger-bitcoin': '^0.3.1' },
        peerDependenciesMeta: { '@ledgerhq/ledger-bitcoin': { optional: true } }
      })

      const missing = checkOptionalPeerDependencies(
        [{ name: '@bitcoinerlab/descriptors', path: modulePath, version: '1.0.0', isLocal: false }],
        tempDir
      )

      expect(missing).toHaveLength(0)
    })

    it('should find optional peers declared by transitive dependencies', () => {
      const btcPath = writeModule('@tetherto/wdk-wallet-btc', {
        dependencies: { '@bitcoinerlab/descriptors': '^2.0.0' }
      })
      writeModule('@bitcoinerlab/descriptors', {
        peerDependencies: {
          '@ledgerhq/ledger-bitcoin': '^0.3.1',
          'some-required-peer': '^1.0.0'
        },
        peerDependenciesMeta: { '@ledgerhq/ledger-bitcoin': { optional: true } }
      })

      const missing = checkOptionalPeerDependencies(
        [{ name: '@tetherto/wdk-wallet-btc', path: btcPath, version: '1.0.0', isLocal: false }],
        tempDir
      )

      expect(missing.map(m => m.name)).toEqual(['some-required-peer'])
    })

    it('should not report installed peers', () => {
      const modulePath = writeModule('@tetherto/wdk-wallet-btc', {
        peerDependencies: { 'some-required-peer': '^1.0.0' }
      })
      writeModule('some-required-peer', {})

      const missing = checkOptionalPeerDependencies(
        [{ name: '@tetherto/wdk-wallet-btc', path: modulePath, version: '1.0.0', isLocal: false }],
        tempDir
      )

      expect(missing).toHaveLength(0)
    })

    it('should list missing optional peers for deferral via findMissingOptionalPeers', () => {
      const modulePath = writeModule('@bitcoinerlab/descriptors', {
        peerDependencies: { '@ledgerhq/ledger-bitcoin': '^0.3.1' },
        peerDependenciesMeta: { '@ledgerhq/ledger-bitcoin': { optional: true } }
      })

      const deferred = findMissingOptionalPeers(
        [{ name: '@bitcoinerlab/descriptors', path: modulePath, version: '1.0.0', isLocal: false }],
        tempDir
      )

      expect(deferred).toEqual(['@ledgerhq/ledger-bitcoin'])
    })

    it('should find optional peers declared only in peerDependenciesMeta', () => {
      // follow-redirects style: no peerDependencies entry at all
      const modulePath = writeModule('follow-redirects', {
        peerDependenciesMeta: { debug: { optional: true } }
      })

      const deferred = findMissingOptionalPeers(
        [{ name: 'follow-redirects', path: modulePath, version: '1.0.0', isLocal: false }],
        tempDir
      )

      expect(deferred).toEqual(['debug'])
      expect(checkOptionalPeerDependencies(
        [{ name: 'follow-redirects', path: modulePath, version: '1.0.0', isLocal: false }],
        tempDir
      )).toHaveLength(0)
    })

    it('should not list installed optional peers for deferral', () => {
      const modulePath = writeModule('@bitcoinerlab/descriptors', {
        peerDependencies: { '@ledgerhq/ledger-bitcoin': '^0.3.1' },
        peerDependenciesMeta: { '@ledgerhq/ledger-bitcoin': { optional: true } }
      })
      writeModule('@ledgerhq/ledger-bitcoin', {})

      const deferred = findMissingOptionalPeers(
        [{ name: '@bitcoinerlab/descriptors', path: modulePath, version: '1.0.0', isLocal: false }],
        tempDir
      )

      expect(deferred).toEqual([])
    })

    it('should not defer an optional peer that is present nested under another package', () => {
      // Real-world shape: @bitcoinerlab/descriptors-core (pulled by wdk-wallet-btc)
      // declares @scure/btc-signer as an optional peer, while @buildonspark/spark-sdk
      // (pulled by wdk-wallet-spark) genuinely depends on it — nested under spark-sdk
      // because a version conflict prevents hoisting. Deferring it drops it from the
      // bundle and fails at runtime with MODULE_NOT_FOUND.
      const descriptorsPath = writeModule('@bitcoinerlab/descriptors-core', {
        peerDependencies: { '@scure/btc-signer': '^1.5.0' },
        peerDependenciesMeta: { '@scure/btc-signer': { optional: true } }
      })
      // Present nested: node_modules/@buildonspark/spark-sdk/node_modules/@scure/btc-signer
      const sparkNested = path.join(
        tempDir, 'node_modules', '@buildonspark', 'spark-sdk',
        'node_modules', '@scure', 'btc-signer'
      )
      fs.mkdirSync(sparkNested, { recursive: true })
      fs.writeFileSync(
        path.join(sparkNested, 'package.json'),
        JSON.stringify({ name: '@scure/btc-signer', version: '1.8.1' })
      )

      const deferred = findMissingOptionalPeers(
        [{ name: '@bitcoinerlab/descriptors-core', path: descriptorsPath, version: '1.0.0', isLocal: false }],
        tempDir
      )

      expect(deferred).toEqual([])
    })

    it('collectInstalledPackages finds hoisted, nested, and scoped-nested packages', () => {
      writeModule('hoisted-pkg', {})
      const scopedNested = path.join(
        tempDir, 'node_modules', '@buildonspark', 'spark-sdk',
        'node_modules', '@scure', 'btc-signer'
      )
      fs.mkdirSync(scopedNested, { recursive: true })
      fs.writeFileSync(path.join(scopedNested, 'package.json'), JSON.stringify({ name: '@scure/btc-signer', version: '1.8.1' }))
      fs.writeFileSync(
        path.join(tempDir, 'node_modules', '@buildonspark', 'spark-sdk', 'package.json'),
        JSON.stringify({ name: '@buildonspark/spark-sdk', version: '1.0.0' })
      )

      const installed = collectInstalledPackages(tempDir)

      expect(installed.has('hoisted-pkg')).toBe(true)
      expect(installed.has('@buildonspark/spark-sdk')).toBe(true)
      expect(installed.has('@scure/btc-signer')).toBe(true)
      expect(installed.has('@ledgerhq/ledger-bitcoin')).toBe(false)
    })

    it('collectInstalledPackages finds packages nested under a symlinked package', () => {
      // Workspace layout: the linked package's own node_modules must be
      // walked through the symlink.
      const realWorkspacePkg = path.join(tempDir, 'packages', 'my-lib')
      const innerNested = path.join(realWorkspacePkg, 'node_modules', 'inner-dep')
      fs.mkdirSync(innerNested, { recursive: true })
      fs.writeFileSync(path.join(realWorkspacePkg, 'package.json'), JSON.stringify({ name: 'my-lib', version: '1.0.0' }))
      fs.writeFileSync(path.join(innerNested, 'package.json'), JSON.stringify({ name: 'inner-dep', version: '1.0.0' }))

      fs.mkdirSync(path.join(tempDir, 'node_modules'), { recursive: true })
      fs.symlinkSync(realWorkspacePkg, path.join(tempDir, 'node_modules', 'my-lib'), 'dir')

      const installed = collectInstalledPackages(tempDir)

      expect(installed.has('my-lib')).toBe(true)
      expect(installed.has('inner-dep')).toBe(true)
    })

    it('collectInstalledPackages terminates on symlink cycles', () => {
      // loop-pkg/node_modules points back at the root node_modules — without
      // realpath-keyed visited tracking this would recurse forever.
      const rootNm = path.join(tempDir, 'node_modules')
      const loopPkg = path.join(rootNm, 'loop-pkg')
      fs.mkdirSync(loopPkg, { recursive: true })
      fs.writeFileSync(path.join(loopPkg, 'package.json'), JSON.stringify({ name: 'loop-pkg', version: '1.0.0' }))
      fs.symlinkSync(rootNm, path.join(loopPkg, 'node_modules'), 'dir')
      writeModule('other-pkg', {})

      const installed = collectInstalledPackages(tempDir)

      expect(installed.has('loop-pkg')).toBe(true)
      expect(installed.has('other-pkg')).toBe(true)
    })

    it('should not defer an optional peer installed via symlink (npm link style)', () => {
      // Real package directory outside node_modules, symlinked in — the
      // layout npm link, file: directory deps, and pnpm produce.
      // fs.existsSync follows symlinks, so the scanner must see it as installed.
      const realDir = path.join(tempDir, 'checkouts', 'ledger-bitcoin')
      fs.mkdirSync(realDir, { recursive: true })
      fs.writeFileSync(
        path.join(realDir, 'package.json'),
        JSON.stringify({ name: '@ledgerhq/ledger-bitcoin', version: '0.3.1' })
      )
      const scopeDir = path.join(tempDir, 'node_modules', '@ledgerhq')
      fs.mkdirSync(scopeDir, { recursive: true })
      fs.symlinkSync(realDir, path.join(scopeDir, 'ledger-bitcoin'), 'dir')

      const descriptorsPath = writeModule('@bitcoinerlab/descriptors', {
        peerDependencies: { '@ledgerhq/ledger-bitcoin': '^0.3.1' },
        peerDependenciesMeta: { '@ledgerhq/ledger-bitcoin': { optional: true } }
      })

      expect(resolveModule('@ledgerhq/ledger-bitcoin', tempDir)?.version).toBe('0.3.1')
      expect(findMissingOptionalPeers(
        [{ name: '@bitcoinerlab/descriptors', path: descriptorsPath, version: '1.0.0', isLocal: false }],
        tempDir
      )).toEqual([])
    })

    it('should defer an optional peer whose symlink is dangling', () => {
      // A symlink whose target was deleted: existsSync follows the link and
      // returns false, so the package is effectively absent and must be
      // deferred like any other missing optional peer.
      const scopeDir = path.join(tempDir, 'node_modules', '@ledgerhq')
      fs.mkdirSync(scopeDir, { recursive: true })
      fs.symlinkSync(path.join(tempDir, 'deleted-target'), path.join(scopeDir, 'ledger-bitcoin'), 'dir')

      const descriptorsPath = writeModule('@bitcoinerlab/descriptors', {
        peerDependencies: { '@ledgerhq/ledger-bitcoin': '^0.3.1' },
        peerDependenciesMeta: { '@ledgerhq/ledger-bitcoin': { optional: true } }
      })

      expect(resolveModule('@ledgerhq/ledger-bitcoin', tempDir)).toBeNull()
      expect(findMissingOptionalPeers(
        [{ name: '@bitcoinerlab/descriptors', path: descriptorsPath, version: '1.0.0', isLocal: false }],
        tempDir
      )).toEqual(['@ledgerhq/ledger-bitcoin'])
    })

    it('should never defer a peer required elsewhere (required scanned first)', () => {
      const requirerPath = writeModule('pkg-requirer', {
        peerDependencies: { 'shared-peer': '^4.0.0' }
      })
      const optionalPath = writeModule('pkg-optional', {
        peerDependencies: { 'shared-peer': '*' },
        peerDependenciesMeta: { 'shared-peer': { optional: true } }
      })
      const requirer = { name: 'pkg-requirer', path: requirerPath, version: '1.0.0', isLocal: false }
      const optional = { name: 'pkg-optional', path: optionalPath, version: '1.0.0', isLocal: false }

      const result = scanPeerDependencies([requirer, optional], tempDir)

      expect(result.missingOptional).toEqual([])
      expect(result.missing).toHaveLength(1)
      expect(result.missing[0].name).toBe('shared-peer')
      // Only the actual requirer is listed as a source — no '*' range pollution
      expect(result.missing[0].sources).toEqual([{ parent: 'pkg-requirer', range: '^4.0.0' }])
    })

    it('should never defer a peer required elsewhere (optional scanned first)', () => {
      const requirerPath = writeModule('pkg-requirer', {
        peerDependencies: { 'shared-peer': '^4.0.0' }
      })
      const optionalPath = writeModule('pkg-optional', {
        peerDependencies: { 'shared-peer': '*' },
        peerDependenciesMeta: { 'shared-peer': { optional: true } }
      })
      const requirer = { name: 'pkg-requirer', path: requirerPath, version: '1.0.0', isLocal: false }
      const optional = { name: 'pkg-optional', path: optionalPath, version: '1.0.0', isLocal: false }

      const result = scanPeerDependencies([optional, requirer], tempDir)

      expect(result.missingOptional).toEqual([])
      expect(result.missing).toHaveLength(1)
      expect(result.missing[0].name).toBe('shared-peer')
      expect(result.missing[0].sources).toEqual([{ parent: 'pkg-requirer', range: '^4.0.0' }])
    })

    it('should ignore meta-only peers not marked optional', () => {
      const modulePath = writeModule('weird-pkg', {
        peerDependenciesMeta: { 'not-really-a-peer': {} }
      })

      const result = scanPeerDependencies(
        [{ name: 'weird-pkg', path: modulePath, version: '1.0.0', isLocal: false }],
        tempDir
      )

      expect(result.missing).toHaveLength(0)
      expect(result.missingOptional).toHaveLength(0)
    })

    it('should keep checkOptionalPeerDependencies as alias of findMissingRequiredPeers', () => {
      expect(checkOptionalPeerDependencies).toBe(findMissingRequiredPeers)
    })

    it('skipOptional skips optional-peer bookkeeping without affecting missing', () => {
      const modulePath = writeModule('@tetherto/wdk-wallet-btc', {
        peerDependencies: {
          'some-required-peer': '^1.0.0',
          '@ledgerhq/ledger-bitcoin': '^0.3.1'
        },
        peerDependenciesMeta: { '@ledgerhq/ledger-bitcoin': { optional: true } }
      })
      const installedModules = [{ name: '@tetherto/wdk-wallet-btc', path: modulePath, version: '1.0.0', isLocal: false }]

      const full = scanPeerDependencies(installedModules, tempDir)
      const skipped = scanPeerDependencies(installedModules, tempDir, { skipOptional: true })

      // .missing is identical either way — optional peers never contribute to it
      expect(skipped.missing.map(m => m.name)).toEqual(full.missing.map(m => m.name))
      expect(skipped.missing.map(m => m.name)).toEqual(['some-required-peer'])

      // optional bookkeeping only happens on the full scan
      expect(full.missingOptional).toEqual(['@ledgerhq/ledger-bitcoin'])
      expect(skipped.missingOptional).toEqual([])
    })

    it('should skip ignored peer prefixes', () => {
      const modulePath = writeModule('@tetherto/wdk-wallet-btc', {
        peerDependencies: { 'react-native': '*', react: '*' }
      })

      const missing = checkOptionalPeerDependencies(
        [{ name: '@tetherto/wdk-wallet-btc', path: modulePath, version: '1.0.0', isLocal: false }],
        tempDir
      )

      expect(missing).toHaveLength(0)
    })
  })

  describe('detectPackageManager', () => {
    it('should detect pnpm', () => {
      fs.writeFileSync(path.join(tempDir, 'pnpm-lock.yaml'), '')
      expect(detectPackageManager(tempDir)).toBe('pnpm')
    })

    it('should detect yarn', () => {
      fs.writeFileSync(path.join(tempDir, 'yarn.lock'), '')
      expect(detectPackageManager(tempDir)).toBe('yarn')
    })

    it('should default to npm', () => {
      expect(detectPackageManager(tempDir)).toBe('npm')
    })

    it('should prefer pnpm over yarn if both exist', () => {
      fs.writeFileSync(path.join(tempDir, 'pnpm-lock.yaml'), '')
      fs.writeFileSync(path.join(tempDir, 'yarn.lock'), '')
      expect(detectPackageManager(tempDir)).toBe('pnpm')
    })
  })

  describe('generateInstallCommand', () => {
    it('should generate npm install command', () => {
      const missing = ['@tetherto/wdk', '@tetherto/wdk-wallet-evm-erc-4337']
      const cmd = generateInstallCommand(missing, 'npm')
      expect(cmd).toBe('npm install @tetherto/wdk @tetherto/wdk-wallet-evm-erc-4337')
    })

    it('should generate yarn add command', () => {
      const missing = ['@tetherto/wdk']
      const cmd = generateInstallCommand(missing, 'yarn')
      expect(cmd).toBe('yarn add @tetherto/wdk')
    })

    it('should generate pnpm add command', () => {
      const missing = ['@tetherto/wdk']
      const cmd = generateInstallCommand(missing, 'pnpm')
      expect(cmd).toBe('pnpm add @tetherto/wdk')
    })

    it('should filter out local paths', () => {
      const missing = ['@tetherto/wdk', './local-module', '/absolute/path']
      const cmd = generateInstallCommand(missing, 'npm')
      expect(cmd).toBe('npm install @tetherto/wdk')
    })

    it('should return empty string if only local paths', () => {
      const missing = ['./local-module', '/absolute/path']
      const cmd = generateInstallCommand(missing, 'npm')
      expect(cmd).toBe('')
    })
  })

  describe('installDependencies', () => {
    it('should return error for local paths only', () => {
      const result = installDependencies(['./local-module', '/absolute/path'], tempDir)

      expect(result.success).toBe(false)
      expect(result.command).toBe('')
      expect(result.installed).toHaveLength(0)
      expect(result.failed).toContain('./local-module')
      expect(result.failed).toContain('/absolute/path')
      expect(result.error).toContain('Cannot auto-install local paths')
    })

    it('should return success with no packages when array is empty', () => {
      const result = installDependencies([], tempDir)

      expect(result.success).toBe(true)
      expect(result.command).toBe('')
      expect(result.installed).toHaveLength(0)
      expect(result.failed).toHaveLength(0)
    })

    it('should detect package manager and generate correct command', () => {
      fs.writeFileSync(path.join(tempDir, 'pnpm-lock.yaml'), '')

      const result = installDependencies(['nonexistent-package-xyz'], tempDir)

      expect(result.command).toBe('pnpm add nonexistent-package-xyz')
      expect(result.success).toBe(false)
    })

    it('should separate npm packages from local paths', () => {
      const result = installDependencies(
        ['@tetherto/wdk', './local-module'],
        tempDir
      )

      expect(result.failed).toContain('./local-module')
      expect(result.command).toBe('npm install @tetherto/wdk')
    })

    it('should report partial success with local path warning', () => {
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'test', version: '1.0.0' })
      )

      const result = installDependencies(['./missing-local'], tempDir)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Cannot auto-install local paths')
    })
  })

  describe('generateUninstallCommand', () => {
    it('should generate npm uninstall command', () => {
      const packages = ['@tetherto/wdk', '@tetherto/wdk-wallet-evm-erc-4337']
      const cmd = generateUninstallCommand(packages, 'npm')
      expect(cmd).toBe('npm uninstall @tetherto/wdk @tetherto/wdk-wallet-evm-erc-4337')
    })

    it('should generate yarn remove command', () => {
      const packages = ['@tetherto/wdk']
      const cmd = generateUninstallCommand(packages, 'yarn')
      expect(cmd).toBe('yarn remove @tetherto/wdk')
    })

    it('should generate pnpm remove command', () => {
      const packages = ['@tetherto/wdk']
      const cmd = generateUninstallCommand(packages, 'pnpm')
      expect(cmd).toBe('pnpm remove @tetherto/wdk')
    })

    it('should filter out local paths', () => {
      const packages = ['@tetherto/wdk', './local-module', '/absolute/path']
      const cmd = generateUninstallCommand(packages, 'npm')
      expect(cmd).toBe('npm uninstall @tetherto/wdk')
    })

    it('should return empty string if only local paths', () => {
      const packages = ['./local-module', '/absolute/path']
      const cmd = generateUninstallCommand(packages, 'npm')
      expect(cmd).toBe('')
    })
  })

  describe('uninstallDependencies', () => {
    it('should return success with empty array', () => {
      const result = uninstallDependencies([], tempDir)

      expect(result.success).toBe(true)
      expect(result.command).toBe('')
      expect(result.removed).toHaveLength(0)
      expect(result.failed).toHaveLength(0)
    })

    it('should skip local paths', () => {
      const result = uninstallDependencies(['./local-module'], tempDir)

      expect(result.success).toBe(true)
      expect(result.command).toBe('')
      expect(result.removed).toHaveLength(0)
    })

    it('should detect package manager for uninstall', () => {
      fs.writeFileSync(path.join(tempDir, 'pnpm-lock.yaml'), '')
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'test', version: '1.0.0' })
      )

      const result = uninstallDependencies(['nonexistent-package-xyz'], tempDir)

      expect(result.command).toBe('pnpm remove nonexistent-package-xyz')
    })
  })
})
