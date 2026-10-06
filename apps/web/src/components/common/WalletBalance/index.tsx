import { formatVisualAmount } from '@safe-global/utils/utils/formatters'
import { Skeleton } from '@mui/material'
import { useCurrentChain } from '@/hooks/useChains'
import { FEATURES, hasFeature } from '@safe-global/utils/utils/chains'

const WalletBalance = ({ balance }: { balance: string | bigint | undefined }) => {
  const currentChain = useCurrentChain()

  if (balance === undefined) {
    return <Skeleton width={30} variant="text" sx={{ display: 'inline-block' }} />
  }

  if (typeof balance === 'string') {
    return <>{balance}</>
  }

  // Hedera's eth_getBalance always reports the native HBAR balance pre-scaled to the standard
  // 18-decimal "weibar" convention, regardless of HBAR's own correct 8-decimal
  // chain.nativeCurrency.decimals.
  const decimals =
    currentChain && hasFeature(currentChain, FEATURES.HEDERA) ? 18 : (currentChain?.nativeCurrency.decimals ?? 18)

  return (
    <>
      {formatVisualAmount(balance, decimals)} {currentChain?.nativeCurrency.symbol ?? 'ETH'}
    </>
  )
}

export default WalletBalance
