import type { ReactElement } from 'react'
import { fireEvent, render, waitFor } from '@/tests/test-utils'
import * as hedera from '@/utils/hedera'
import { TxModalContext } from '@/components/tx-flow'
import AssociatedTokensTable from './AssociatedTokensTable'

jest.mock('@/hooks/useSafeInfo')

jest.mock('@/components/common/CheckWallet', () => ({
  __esModule: true,
  default: ({ children }: { children: (ok: boolean) => ReactElement }) => children(true),
}))

jest.mock('@/components/tx-flow/flows', () => ({
  __esModule: true,
  DissociateTokenFlow: ({ token }: { token: { tokenId: string } }) => <div>Dissociate {token.tokenId}</div>,
}))

const mockUseSafeInfo = jest.requireMock('@/hooks/useSafeInfo').default as jest.Mock

const renderTable = (network: 'mainnet' | undefined, setTxFlow = jest.fn()) =>
  render(
    <TxModalContext.Provider value={{ txFlow: undefined, setTxFlow, setFullWidth: jest.fn() }}>
      <AssociatedTokensTable network={network} />
    </TxModalContext.Provider>,
  )

describe('AssociatedTokensTable', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    mockUseSafeInfo.mockReturnValue({
      safeAddress: '0x3DDDCE646712500aB55E1b2d6E61de4C409f50EF',
    })
  })

  it('should render a row for each associated token', async () => {
    jest.spyOn(hedera, 'getHederaAssociatedTokens').mockResolvedValue({
      tokens: [
        {
          tokenId: '0.0.731861',
          evmAddress: '0x00000000000000000000000000000000000b2ad5',
          balance: 0,
          decimals: 6,
          freezeStatus: 'NOT_APPLICABLE',
          createdAt: new Date(),
        },
      ],
      truncated: false,
    })

    const { getByText, getByTestId } = renderTable('mainnet')

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
    jest.spyOn(hedera, 'getHederaAssociatedTokens').mockResolvedValue({ tokens: [], truncated: false })

    const { container } = renderTable('mainnet')

    await waitFor(() => {
      expect(container).toBeEmptyDOMElement()
    })
  })

  it('should render nothing when the network is not resolved yet', () => {
    const spy = jest.spyOn(hedera, 'getHederaAssociatedTokens')

    const { container } = renderTable(undefined)

    expect(spy).not.toHaveBeenCalled()
    expect(container).toBeEmptyDOMElement()
  })

  it('should show a note when the associated-token list is truncated', async () => {
    jest.spyOn(hedera, 'getHederaAssociatedTokens').mockResolvedValue({
      tokens: [
        {
          tokenId: '0.0.731861',
          evmAddress: '0x00000000000000000000000000000000000b2ad5',
          balance: 0,
          decimals: 6,
          freezeStatus: 'NOT_APPLICABLE',
          createdAt: new Date(),
        },
      ],
      truncated: true,
    })

    const { getByText } = renderTable('mainnet')

    await waitFor(() => {
      expect(getByText(/this account has more/i)).toBeInTheDocument()
    })
  })

  it('should open the dissociate flow for a zero-balance token', async () => {
    jest.spyOn(hedera, 'getHederaAssociatedTokens').mockResolvedValue({
      tokens: [
        {
          tokenId: '0.0.731861',
          evmAddress: '0x00000000000000000000000000000000000b2ad5',
          balance: 0,
          decimals: 6,
          freezeStatus: 'NOT_APPLICABLE',
          createdAt: new Date(),
        },
      ],
      truncated: false,
    })

    const setTxFlow = jest.fn()
    const { getByTestId } = renderTable('mainnet', setTxFlow)

    await waitFor(() => {
      expect(getByTestId('dissociate-token-btn')).toBeEnabled()
    })

    fireEvent.click(getByTestId('dissociate-token-btn'))

    expect(setTxFlow).toHaveBeenCalledTimes(1)
  })

  it('should disable the dissociate button while the token still has a balance', async () => {
    jest.spyOn(hedera, 'getHederaAssociatedTokens').mockResolvedValue({
      tokens: [
        {
          tokenId: '0.0.731861',
          evmAddress: '0x00000000000000000000000000000000000b2ad5',
          balance: 10,
          decimals: 6,
          freezeStatus: 'NOT_APPLICABLE',
          createdAt: new Date(),
        },
      ],
      truncated: false,
    })

    const setTxFlow = jest.fn()
    const { getByTestId } = renderTable('mainnet', setTxFlow)

    await waitFor(() => {
      expect(getByTestId('dissociate-token-btn')).toBeDisabled()
    })

    expect(setTxFlow).not.toHaveBeenCalled()
  })
})
