import {
  getHederaAccountId,
  getHederaEvmAddress,
  getHederaContractId,
  getHederaEvmTransactionHash,
  isHederaAccountId,
  hederaEntityIdToEvmAddress,
  getHederaTokenMetadata,
  getHederaAssociatedTokens,
  getHederaTokenExplorerLink,
} from '../hedera'

const originalGlobalFetch = global.fetch

describe('hedera mirror-node helpers', () => {
  afterEach(() => {
    global.fetch = originalGlobalFetch
    jest.clearAllMocks()
  })

  describe('getHederaEvmAddress', () => {
    it('should resolve the evm_address from the testnet mirror node', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ evm_address: '0x0000000000000000000000000000000000004d' }),
      })

      const address = await getHederaEvmAddress('testnet', '0.0.77')

      expect(global.fetch).toHaveBeenCalledWith(
        'https://testnet.mirrornode.hedera.com/api/v1/accounts/0.0.77',
        expect.anything(),
      )
      expect(address).toBe('0x0000000000000000000000000000000000004d')
    })

    it('should resolve the evm_address from the mainnet mirror node', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ evm_address: '0xd89cfd973d251ff04d345a4962afb5efa6382036' }),
      })

      const address = await getHederaEvmAddress('mainnet', '0.0.10814740')

      expect(global.fetch).toHaveBeenCalledWith(
        'https://mainnet-public.mirrornode.hedera.com/api/v1/accounts/0.0.10814740',
        expect.anything(),
      )
      expect(address).toBe('0xd89cfd973d251ff04d345a4962afb5efa6382036')
    })

    it('should cache the result for the same network/account and not re-fetch', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ evm_address: '0x0000000000000000000000000000000000004d' }),
      })

      await getHederaEvmAddress('testnet', '0.0.999')
      await getHederaEvmAddress('testnet', '0.0.999')

      expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    it('should throw when the mirror node responds with an error status', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 })

      await expect(getHederaEvmAddress('testnet', '0.0.notfound')).rejects.toThrow('mirror node returned 404')
    })

    it('should throw when the account has no evm_address', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      })

      await expect(getHederaEvmAddress('testnet', '0.0.no-alias')).rejects.toThrow('has no evm_address')
    })
  })

  describe('getHederaAccountId', () => {
    it('should resolve the native account id from an evm address via the mirror node', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ account: '0.0.10814740' }),
      })

      const accountId = await getHederaAccountId('mainnet', '0xd89cfd973d251ff04d345a4962afb5efa6382036')

      expect(global.fetch).toHaveBeenCalledWith(
        'https://mainnet-public.mirrornode.hedera.com/api/v1/accounts/0xd89cfd973d251ff04d345a4962afb5efa6382036',
        expect.anything(),
      )
      expect(accountId).toBe('0.0.10814740')
    })

    it('should cache the result for the same network/address and not re-fetch', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ account: '0.0.111' }),
      })

      await getHederaAccountId('testnet', '0xabc')
      await getHederaAccountId('testnet', '0xabc')

      expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    it('should throw when the mirror node has no account for the address', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      })

      await expect(getHederaAccountId('testnet', '0xunknown')).rejects.toThrow('No Hedera account found')
    })
  })

  describe('getHederaContractId', () => {
    it('should resolve the native contract id from an evm address via the mirror node', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ contract_id: '0.0.8923237' }),
      })

      const contractId = await getHederaContractId('mainnet', '0xa6b71e26c5e0845f74c812102ca7114b6a896ab2')

      expect(global.fetch).toHaveBeenCalledWith(
        'https://mainnet-public.mirrornode.hedera.com/api/v1/contracts/0xa6b71e26c5e0845f74c812102ca7114b6a896ab2',
        expect.anything(),
      )
      expect(contractId).toBe('0.0.8923237')
    })

    it('should cache the result for the same network/address and not re-fetch', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ contract_id: '0.0.222' }),
      })

      await getHederaContractId('testnet', '0xdef')
      await getHederaContractId('testnet', '0xdef')

      expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    it('should throw when the mirror node has no contract for the address', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      })

      await expect(getHederaContractId('testnet', '0xunknown')).rejects.toThrow('No Hedera contract found')
    })
  })

  describe('getHederaEvmTransactionHash', () => {
    let setTimeoutSpy: jest.SpyInstance

    beforeEach(() => {
      // Skip the real polling delay — resolve setTimeout callbacks immediately.
      setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => {
        fn()
        return 0 as unknown as NodeJS.Timeout
      }) as typeof setTimeout)
    })

    afterEach(() => {
      setTimeoutSpy.mockRestore()
    })

    it('should convert the SDK transaction id format and resolve the real EVM hash', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ hash: '0xdc45fc2a9f8543d50199572a05e149feadd409d142a1cfeba121793d8d3d7dc7' }),
      })

      const hash = await getHederaEvmTransactionHash('mainnet', '0.0.10418723@1789395613.539062406')

      expect(global.fetch).toHaveBeenCalledWith(
        'https://mainnet-public.mirrornode.hedera.com/api/v1/contracts/results/0.0.10418723-1789395613-539062406',
        expect.anything(),
      )
      expect(hash).toBe('0xdc45fc2a9f8543d50199572a05e149feadd409d142a1cfeba121793d8d3d7dc7')
    })

    it('should retry until the transaction is indexed by the mirror node', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 404 })
        .mockResolvedValueOnce({ ok: false, status: 404 })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ hash: '0xabc' }) })

      const hash = await getHederaEvmTransactionHash('testnet', '0.0.1@1700000000.000000000')

      expect(global.fetch).toHaveBeenCalledTimes(3)
      expect(hash).toBe('0xabc')
    })

    it('should throw after exhausting all retry attempts', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 })

      await expect(getHederaEvmTransactionHash('testnet', '0.0.1@1700000000.000000000')).rejects.toThrow(
        'was submitted but its EVM-equivalent hash could not be confirmed',
      )
    })
  })

  describe('isHederaAccountId', () => {
    it('should recognize a native entity id', () => {
      expect(isHederaAccountId('0.0.10814740')).toBe(true)
      expect(isHederaAccountId('  0.0.1  ')).toBe(true)
    })

    it('should reject anything else', () => {
      expect(isHederaAccountId('0xd89cfd973d251ff04d345a4962afb5efa6382036')).toBe(false)
      expect(isHederaAccountId('vitalik.eth')).toBe(false)
      expect(isHederaAccountId('0.0.')).toBe(false)
      expect(isHederaAccountId('')).toBe(false)
    })
  })

  describe('hederaEntityIdToEvmAddress', () => {
    it('should encode the entity number as a long-zero 20-byte address', () => {
      // Matches the token param observed live in an associateToken(account, token) call for
      // token 0.0.731861 (0xb2ad5 in hex).
      expect(hederaEntityIdToEvmAddress('0.0.731861')).toBe('0x00000000000000000000000000000000000b2ad5')
      expect(hederaEntityIdToEvmAddress('0.0.77')).toBe('0x000000000000000000000000000000000000004d')
    })
  })

  describe('getHederaTokenMetadata', () => {
    it('should resolve token metadata and compute its long-zero evm address', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            token_id: '0.0.731861',
            name: 'SAUCE',
            symbol: 'SAUCE',
            decimals: '6',
            type: 'FUNGIBLE_COMMON',
            deleted: false,
          }),
      })

      const metadata = await getHederaTokenMetadata('mainnet', '0.0.731861')

      expect(global.fetch).toHaveBeenCalledWith(
        'https://mainnet-public.mirrornode.hedera.com/api/v1/tokens/0.0.731861',
        expect.anything(),
      )
      expect(metadata).toEqual({
        tokenId: '0.0.731861',
        evmAddress: '0x00000000000000000000000000000000000b2ad5',
        name: 'SAUCE',
        symbol: 'SAUCE',
        decimals: 6,
        type: 'FUNGIBLE_COMMON',
        deleted: false,
      })
    })

    it('should accept a 0x address lookup too', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            token_id: '0.0.456858',
            name: 'USD Coin',
            symbol: 'USDC',
            decimals: '6',
            type: 'FUNGIBLE_COMMON',
          }),
      })

      const evmAddress = '0x0000000000000000000000000000000006f8da'
      await getHederaTokenMetadata('mainnet', evmAddress)

      expect(global.fetch).toHaveBeenCalledWith(
        `https://mainnet-public.mirrornode.hedera.com/api/v1/tokens/${evmAddress}`,
        expect.anything(),
      )
    })

    it('should throw when the mirror node responds with an error status', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 })

      await expect(getHederaTokenMetadata('testnet', '0.0.notfound')).rejects.toThrow('mirror node returned 404')
    })

    it('should throw when no token is found', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      })

      await expect(getHederaTokenMetadata('testnet', '0.0.unknown')).rejects.toThrow('No Hedera token found')
    })
  })

  describe('getHederaAssociatedTokens', () => {
    it('should list associated tokens and compute each long-zero evm address', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            tokens: [
              {
                automatic_association: false,
                balance: 0,
                created_timestamp: '1789555147.748551105',
                decimals: 6,
                token_id: '0.0.731861',
                freeze_status: 'NOT_APPLICABLE',
                kyc_status: 'NOT_APPLICABLE',
              },
            ],
            links: { next: null },
          }),
      })

      const result = await getHederaAssociatedTokens('mainnet', '0x3DDDCE646712500aB55E1b2d6E61de4C409f50EF')

      expect(global.fetch).toHaveBeenCalledWith(
        'https://mainnet-public.mirrornode.hedera.com/api/v1/accounts/0x3DDDCE646712500aB55E1b2d6E61de4C409f50EF/tokens',
        expect.anything(),
      )
      expect(result.truncated).toBe(false)
      expect(result.tokens).toEqual([
        {
          tokenId: '0.0.731861',
          evmAddress: '0x00000000000000000000000000000000000b2ad5',
          balance: 0,
          decimals: 6,
          freezeStatus: 'NOT_APPLICABLE',
          createdAt: new Date(1789555147 * 1000),
        },
      ])
    })

    it('should follow links.next pagination', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              tokens: [
                {
                  balance: 1,
                  decimals: 2,
                  token_id: '0.0.1',
                  freeze_status: 'NOT_APPLICABLE',
                  created_timestamp: '1700000000.0',
                },
              ],
              links: { next: '/api/v1/accounts/0.0.2/tokens?limit=1&token.id=gt:0.0.1' },
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              tokens: [
                {
                  balance: 2,
                  decimals: 3,
                  token_id: '0.0.2',
                  freeze_status: 'FROZEN',
                  created_timestamp: '1700000001.0',
                },
              ],
              links: { next: null },
            }),
        })

      const result = await getHederaAssociatedTokens('testnet', '0.0.2')

      expect(global.fetch).toHaveBeenCalledTimes(2)
      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        'https://testnet.mirrornode.hedera.com/api/v1/accounts/0.0.2/tokens?limit=1&token.id=gt:0.0.1',
        expect.anything(),
      )
      expect(result.truncated).toBe(false)
      expect(result.tokens.map((token) => token.tokenId)).toEqual(['0.0.1', '0.0.2'])
    })

    it('should throw when the mirror node responds with an error status', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 })

      await expect(getHederaAssociatedTokens('testnet', '0.0.notfound')).rejects.toThrow('mirror node returned 404')
    })
  })

  describe('getHederaTokenExplorerLink', () => {
    it('should build a HashScan token (not account) link', () => {
      expect(getHederaTokenExplorerLink('mainnet', '0x00000000000000000000000000000000000b2ad5')).toBe(
        'https://hashscan.io/mainnet/token/0x00000000000000000000000000000000000b2ad5',
      )
      expect(getHederaTokenExplorerLink('testnet', '0x123')).toBe('https://hashscan.io/testnet/token/0x123')
    })
  })
})
