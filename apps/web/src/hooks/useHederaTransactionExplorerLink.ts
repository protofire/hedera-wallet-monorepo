import { FEATURES, hasFeature } from '@safe-global/utils/utils/chains'
import { getHederaTransactionExplorerLink } from '@/utils/hedera'
import { useCurrentChain } from './useChains'

/**
 * HashScan link for a transaction the backend reports a native Hedera transaction id for (only
 * native, non-EVM transfers have one). Undefined for every other transaction and on non-Hedera
 * chains, so callers can fall back to the regular `txHash` explorer link.
 */
const useHederaTransactionExplorerLink = (
  hederaTransactionId?: string,
): { href: string; title: string } | undefined => {
  const chain = useCurrentChain()

  if (!hederaTransactionId || !chain || !hasFeature(chain, FEATURES.HEDERA)) return undefined

  const href = getHederaTransactionExplorerLink(chain.isTestnet ? 'testnet' : 'mainnet', hederaTransactionId)
  return { href, title: `View on ${new URL(href).hostname}` }
}

export default useHederaTransactionExplorerLink
