import { useMemo } from 'react'
import { formatDistanceToNow } from 'date-fns'
import useAsync from '@safe-global/utils/hooks/useAsync'
import EnhancedTable from '@/components/common/EnhancedTable'
import EthHashInfo from '@/components/common/EthHashInfo'
import ExplorerButton from '@/components/common/ExplorerButton'
import useSafeInfo from '@/hooks/useSafeInfo'
import { getHederaAssociatedTokens, getHederaTokenExplorerLink, type HederaNetwork } from '@/utils/hedera'

const headCells = [
  { id: 'tokenId', label: 'Token ID' },
  { id: 'balance', label: 'Balance' },
  { id: 'decimals', label: 'Decimals' },
  { id: 'freezeStatus', label: 'Freeze Status' },
  { id: 'created', label: 'Created' },
]

const AssociatedTokensTable = ({ network }: { network?: HederaNetwork }) => {
  const { safeAddress } = useSafeInfo()

  const [tokens] = useAsync(() => {
    if (!network) return
    return getHederaAssociatedTokens(network, safeAddress)
  }, [network, safeAddress])

  const rows = useMemo(
    () =>
      (tokens ?? []).map((token) => ({
        key: token.tokenId,
        cells: {
          tokenId: {
            rawValue: token.tokenId,
            content: (
              <EthHashInfo address={token.evmAddress} showAvatar={false} showCopyButton>
                {network && (
                  <ExplorerButton
                    title="View token on HashScan"
                    href={getHederaTokenExplorerLink(network, token.evmAddress)}
                  />
                )}
              </EthHashInfo>
            ),
          },
          balance: { rawValue: token.balance, content: token.balance },
          decimals: { rawValue: token.decimals, content: token.decimals },
          freezeStatus: { rawValue: token.freezeStatus, content: token.freezeStatus },
          created: {
            rawValue: token.createdAt.getTime(),
            content: formatDistanceToNow(token.createdAt, { addSuffix: true }),
          },
        },
      })),
    [tokens, network],
  )

  if (rows.length === 0) return null

  return <EnhancedTable rows={rows} headCells={headCells} />
}

export default AssociatedTokensTable
