import { validateConfig } from '../../src/config/schema'

describe('Config Schema Validation', () => {
  describe('validateConfig', () => {
    it('should validate a correct config', () => {
      const config = {
        networks: {
          ethereum: {
            package: '@tetherto/wdk-wallet-evm-erc-4337'
          }
        },
        protocols: {
          aave: {
            package: '@tetherto/wdk-protocol-aave-v3'
          }
        },
        preloadModules: ['native-addon'],
        output: {
          bundle: './dist/bundle.js',
          types: './dist/types.d.ts'
        },
        options: {
          minify: true,
          sourceMaps: true,
          targets: ['android-arm64']
        }
      }

      expect(() => validateConfig(config)).not.toThrow()
    })

    it('should fail if networks is missing', () => {
      const config = {
        options: {}
      }

      expect(() => validateConfig(config)).toThrow('must have required property \'networks\'')
    })

    it('should fail if network package is missing', () => {
      const config = {
        networks: {
          ethereum: {
          }
        }
      }

      expect(() => validateConfig(config)).toThrow('must have required property \'package\'')
    })

    it('should fail if networks is empty', () => {
      const config = {
        networks: {}
      }

      expect(() => validateConfig(config)).toThrow('must NOT have fewer than 1 properties')
    })

    it('should validate protocols if present', () => {
      const config = {
        networks: {
          eth: { package: 'pkg' }
        },
        protocols: {
          myproto: {
          }
        }
      }
      expect(() => validateConfig(config)).toThrow('must have required property \'package\'')
    })

    it('should validate a config with a modules section', () => {
      const config = {
        networks: { eth: { package: 'pkg' } },
        modules: {
          addressBook: {
            package: '@tetherto/wdk-p2p-address-book',
            factory: 'createModule',
            events: ['update']
          }
        }
      }
      expect(() => validateConfig(config)).not.toThrow()
    })

    it('should validate a minimal module (package only)', () => {
      const config = {
        networks: { eth: { package: 'pkg' } },
        modules: { addressBook: { package: '@tetherto/wdk-p2p-address-book' } }
      }
      expect(() => validateConfig(config)).not.toThrow()
    })

    it('should fail if a module package is missing', () => {
      const config = {
        networks: { eth: { package: 'pkg' } },
        modules: { addressBook: { events: ['update'] } }
      }
      expect(() => validateConfig(config)).toThrow('must have required property \'package\'')
    })

    it('should validate a config with allowedMethods', () => {
      const config = {
        networks: { ethereum: { package: 'pkg' } },
        allowedMethods: {
          ethereum: {
            methods: ['getAddress', 'getBalance'],
            protocols: { swap: { uniswap: { methods: ['quoteSwap'] } } }
          }
        }
      }
      expect(() => validateConfig(config)).not.toThrow()
    })

    it('should fail if a network methods entry is not a string array', () => {
      const config = {
        networks: { eth: { package: 'pkg' } },
        allowedMethods: { eth: { methods: 'getAddress' } }
      }
      expect(() => validateConfig(config)).toThrow('must be array')
    })

    it('should fail if allowedMethods is a flat surface -> array map (old shape)', () => {
      const config = {
        networks: { eth: { package: 'pkg' } },
        allowedMethods: { eth: ['getAddress'] }
      }
      expect(() => validateConfig(config)).toThrow('must be object')
    })

    it('should validate a config with allowedModuleMethods', () => {
      const config = {
        networks: { ethereum: { package: 'pkg' } },
        allowedModuleMethods: {
          addressBook: { methods: ['list', 'add'] }
        }
      }
      expect(() => validateConfig(config)).not.toThrow()
    })

    it('should fail if an allowedModuleMethods entry methods is not a string array', () => {
      const config = {
        networks: { eth: { package: 'pkg' } },
        allowedModuleMethods: { addressBook: { methods: 'list' } }
      }
      expect(() => validateConfig(config)).toThrow('must be array')
    })

    it('should validate options.handleLeakCheck set to true', () => {
      const config = {
        networks: { eth: { package: 'pkg' } },
        options: { handleLeakCheck: true }
      }
      expect(() => validateConfig(config)).not.toThrow()
    })

    it('should validate options.handleLeakCheck set to a positive number', () => {
      const config = {
        networks: { eth: { package: 'pkg' } },
        options: { handleLeakCheck: 5000 }
      }
      expect(() => validateConfig(config)).not.toThrow()
    })

    it('should fail if options.handleLeakCheck is false', () => {
      const config = {
        networks: { eth: { package: 'pkg' } },
        options: { handleLeakCheck: false }
      }
      expect(() => validateConfig(config)).toThrow('Invalid configuration')
    })

    it('should fail if options.handleLeakCheck is a string', () => {
      const config = {
        networks: { eth: { package: 'pkg' } },
        options: { handleLeakCheck: '5000' }
      }
      expect(() => validateConfig(config)).toThrow('Invalid configuration')
    })

    it('should fail if options.handleLeakCheck is zero', () => {
      const config = {
        networks: { eth: { package: 'pkg' } },
        options: { handleLeakCheck: 0 }
      }
      expect(() => validateConfig(config)).toThrow('Invalid configuration')
    })

    it('should fail if options.handleLeakCheck is negative', () => {
      const config = {
        networks: { eth: { package: 'pkg' } },
        options: { handleLeakCheck: -1000 }
      }
      expect(() => validateConfig(config)).toThrow('Invalid configuration')
    })

    it('should fail if options.handleLeakCheck is NaN', () => {
      const config = {
        networks: { eth: { package: 'pkg' } },
        options: { handleLeakCheck: NaN }
      }
      expect(() => validateConfig(config)).toThrow('Invalid configuration')
    })
  })
})
