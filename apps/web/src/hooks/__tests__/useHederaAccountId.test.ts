import { renderHook, waitFor } from '@/tests/test-utils'
import * as hedera from '@/utils/hedera'
import useHederaAccountId from '../useHederaAccountId'

describe('useHederaAccountId', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('should return isHedera: false and no accountId on a non-Hedera chain', () => {
    const spy = jest.spyOn(hedera, 'getHederaAccountId')

    const { result } = renderHook(() => useHederaAccountId('0x1234567890000000000000000000000000000000', '1'))

    expect(result.current.isHedera).toBe(false)
    expect(result.current.accountId).toBeUndefined()
    expect(spy).not.toHaveBeenCalled()
  })

  it('should resolve the native account id on a Hedera chain', async () => {
    jest.spyOn(hedera, 'getHederaAccountId').mockResolvedValue('0.0.10814740')

    const { result } = renderHook(() => useHederaAccountId('0xd89cfd973d251ff04d345a4962afb5efa6382036', '295'))

    expect(result.current.isHedera).toBe(true)

    await waitFor(() => {
      expect(result.current.accountId).toBe('0.0.10814740')
    })
  })

  it('should work for Hedera testnet too', async () => {
    const spy = jest.spyOn(hedera, 'getHederaAccountId').mockResolvedValue('0.0.999')

    const { result } = renderHook(() => useHederaAccountId('0xabc', '296'))

    await waitFor(() => {
      expect(result.current.accountId).toBe('0.0.999')
    })
    expect(spy).toHaveBeenCalledWith('testnet', '0xabc')
  })
})
