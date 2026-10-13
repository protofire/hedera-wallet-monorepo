import { render } from '@/tests/test-utils'
import * as useChains from '@/hooks/useChains'
import { chainBuilder } from '@/tests/builders/chains'
import { FEATURES } from '@safe-global/utils/utils/chains'
import type { TransferTransactionInfo } from '@safe-global/store/gateway/AUTO_GENERATED/transactions'
import { TransferTx } from '.'

const hederaChain = chainBuilder()
  .with({
    chainId: '295',
    features: [FEATURES.HEDERA],
    nativeCurrency: { name: 'HBAR', symbol: 'HBAR', decimals: 8, logoUri: 'https://example.com/hbar.png' },
  })
  .build()

const addressInfo = { value: '0x00000000000000000000000000000000a5236f' }

const nativeTransferInfo = (
  direction: TransferTransactionInfo['direction'],
  value: string,
): TransferTransactionInfo => ({
  type: 'Transfer',
  sender: addressInfo,
  recipient: addressInfo,
  direction,
  transferInfo: { type: 'NATIVE_COIN', value },
})

describe('TransferTx (Hedera native transfer decimals)', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('should format an outgoing (Safe-executed) transfer using HBAR tinybar decimals, not weibar', () => {
    // Regression: outgoing transfers carry the raw value we ourselves submitted at 8-decimal
    // tinybar precision (10_000 tinybar === 0.0001 HBAR) — applying an 18-decimal override here
    // made it render as 0.00000000000001.
    jest.spyOn(useChains, 'useCurrentChain').mockReturnValue(hederaChain)

    const { getByText } = render(<TransferTx info={nativeTransferInfo('OUTGOING', '10000')} />)

    expect(getByText(/0\.0001/)).toBeInTheDocument()
    expect(() => getByText(/0\.00000000000001/)).toThrow()
  })

  it('should format an incoming transfer using the 18-decimal weibar convention Hashio reports it in', () => {
    // Incoming transfers are indexed via Hashio's JSON-RPC, which always reports value pre-scaled
    // to 18-decimal weibar (10_000 tinybar === 100_000_000_000_000 weibar === 0.0001 HBAR).
    jest.spyOn(useChains, 'useCurrentChain').mockReturnValue(hederaChain)

    const { getByText } = render(<TransferTx info={nativeTransferInfo('INCOMING', '100000000000000')} />)

    expect(getByText(/0\.0001/)).toBeInTheDocument()
  })

  it('should not apply the Hedera override on a non-Hedera chain regardless of direction', () => {
    jest.spyOn(useChains, 'useCurrentChain').mockReturnValue(
      chainBuilder()
        .with({
          chainId: '1',
          features: [],
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18, logoUri: 'https://example.com/eth.png' },
        })
        .build(),
    )

    const { getByText } = render(<TransferTx info={nativeTransferInfo('OUTGOING', '100000000000000000')} />)

    expect(getByText(/1(\s|$)/)).toBeInTheDocument()
  })
})
