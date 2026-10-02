import { useContext, useMemo } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { IconButton, SvgIcon, Tooltip, Typography } from '@mui/material'
import useAsync from '@safe-global/utils/hooks/useAsync'
import EnhancedTable from '@/components/common/EnhancedTable'
import tableCss from '@/components/common/EnhancedTable/styles.module.css'
import EthHashInfo from '@/components/common/EthHashInfo'
import ExplorerButton from '@/components/common/ExplorerButton'
import CheckWallet from '@/components/common/CheckWallet'
import DeleteIcon from '@/public/images/common/delete.svg'
import { TxModalContext } from '@/components/tx-flow'
import { DissociateTokenFlow } from '@/components/tx-flow/flows'
import useSafeInfo from '@/hooks/useSafeInfo'
import { getHederaAssociatedTokens, getHederaTokenExplorerLink, type HederaNetwork } from '@/utils/hedera'

const headCells = [
  { id: 'tokenId', label: 'Token ID' },
  { id: 'balance', label: 'Balance' },
  { id: 'decimals', label: 'Decimals' },
  { id: 'freezeStatus', label: 'Freeze Status' },
  { id: 'created', label: 'Created' },
  { id: 'actions', label: '', disableSort: true },
]

const AssociatedTokensTable = ({ network }: { network?: HederaNetwork }) => {
  const { safeAddress } = useSafeInfo()
  const { setTxFlow } = useContext(TxModalContext)

  const [result] = useAsync(() => {
    if (!network) return
    return getHederaAssociatedTokens(network, safeAddress)
  }, [network, safeAddress])

  const tokens = result?.tokens

  const rows = useMemo(
    () =>
      (tokens ?? []).map((token) => {
        // Hedera requires an account's balance of a token to be zero before it can dissociate —
        // a non-zero balance makes the dissociation revert on-chain, so block it here rather than
        // let the user submit a transaction that's guaranteed to fail.
        const canDissociate = token.balance === 0

        return {
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
            actions: {
              rawValue: null,
              sticky: true,
              content: (
                <div className={tableCss.actions}>
                  <CheckWallet>
                    {(isOk) => (
                      <Tooltip title={canDissociate ? '' : 'This token still has a balance — transfer it out first'}>
                        <span>
                          <IconButton
                            data-testid="dissociate-token-btn"
                            onClick={() => setTxFlow(<DissociateTokenFlow token={token} />)}
                            color="error"
                            size="small"
                            disabled={!isOk || !canDissociate}
                            title="Dissociate token"
                          >
                            <SvgIcon component={DeleteIcon} inheritViewBox color="error" fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    )}
                  </CheckWallet>
                </div>
              ),
            },
          },
        }
      }),
    [tokens, network, setTxFlow],
  )

  if (rows.length === 0) return null

  return (
    <>
      <EnhancedTable rows={rows} headCells={headCells} />
      {result?.truncated && (
        <Typography variant="body2" color="text.secondary" mt={1}>
          Showing the first {rows.length} associated tokens — this account has more.
        </Typography>
      )}
    </>
  )
}

export default AssociatedTokensTable
