import { render, waitFor } from '@/tests/test-utils'
import * as hedera from '@/utils/hedera'
import AssociatedTokensTable from './AssociatedTokensTable'

jest.mock('@/hooks/useSafeInfo')

const mockUseSafeInfo = jest.requireMock('@/hooks/useSafeInfo').default as jest.Mock

describe('AssociatedTokensTable', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    mockUseSafeInfo.mockReturnValue({
      safeAddress: '0x3DDDCE646712500aB55E1b2d6E61de4C409f50EF',
    })
  })

  it('should render a row for each associated token', async () => {
    jest.spyOn(hedera, 'getHederaAssociatedTokens').mockResolvedValue([
      {
        tokenId: '0.0.731861',
        evmAddress: '0x00000000000000000000000000000000000b2ad5',
        balance: 0,
        decimals: 6,
        freezeStatus: 'NOT_APPLICABLE',
        createdAt: new Date(),
      },
    ])

    const { getByText, getByTestId } = render(<AssociatedTokensTable network="mainnet" />)

    await waitFor(() => {
      expect(getByText('NOT_APPLICABLE')).toBeInTheDocument()
    })

    expect(getByText('6')).toBeInTheDocument()

    // Regression: the token row's explorer link must point at HashScan's /token/ path, not
    // the generic chain-config /account/ path EthHashInfo's own `hasExplorer` would build.
    expect(getByTestId('explorer-btn')).toHaveAttribute(
      'href',
      'https://hashscan.io/mainnet/token/0x00000000000000000000000000000000000b2ad5',
    )
  })

  it('should render nothing while there are no associated tokens', async () => {
    jest.spyOn(hedera, 'getHederaAssociatedTokens').mockResolvedValue([])

    const { container } = render(<AssociatedTokensTable network="mainnet" />)

    await waitFor(() => {
      expect(container).toBeEmptyDOMElement()
    })
  })

  it('should render nothing when the network is not resolved yet', () => {
    const spy = jest.spyOn(hedera, 'getHederaAssociatedTokens')

    const { container } = render(<AssociatedTokensTable network={undefined} />)

    expect(spy).not.toHaveBeenCalled()
    expect(container).toBeEmptyDOMElement()
  })
})
