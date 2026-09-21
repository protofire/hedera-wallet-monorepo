import type { Balances } from '@safe-global/store/gateway/AUTO_GENERATED/balances'
import type { AppBalance, Portfolio } from '@safe-global/store/gateway/AUTO_GENERATED/portfolios'
import { TokenType } from '@safe-global/store/gateway/types'

export interface PortfolioBalances extends Balances {
  positions?: AppBalance[]
  tokensFiatTotal?: string
  positionsFiatTotal?: string
  isAllTokensMode?: boolean
}

export const initialBalancesState: PortfolioBalances = {
  items: [],
  fiatTotal: '',
}

// Hashio (Hedera's EVM JSON-RPC relay) reports the native HBAR balance — both via
// `eth_getBalance` directly, and via the CGW `/balances` endpoint that derives from it — in the
// standard 18-decimal "weibar" convention. That's a JSON-RPC wire-format quirk, applied only at
// the relay boundary for EVM-tooling compatibility (eth_getBalance, gas price, msg.value of the
// *outer* transaction) — it does NOT apply inside the EVM itself: `.balance`, `msg.value`, and
// any `.call{value: v}(...)` a contract performs (e.g. a Safe's own internal transfer inside
// execTransaction) all operate in Hedera's real, native tinybar (8-decimal) unit. See
// https://dev.to/edycutjong/hederas-evm-speaks-tinybar-its-rpc-speaks-weibar-and-both-mistakes-return-success-132e
// Convert the *raw balance number* down to tinybar here, once, rather than the token's
// `decimals` metadata (which is already correctly 8) — that keeps `balance` and `decimals`
// paired correctly for every consumer, whether it's just displaying the balance or using it to
// construct an actual transfer's on-chain value.
const HEDERA_WEIBAR_TO_TINYBAR = 10n ** 10n

const withHederaNativeBalance = (balances: Balances, isHedera: boolean | undefined): Balances => {
  if (!isHedera) return balances

  return {
    ...balances,
    items: balances.items.map((item) =>
      item.tokenInfo.type === TokenType.NATIVE_TOKEN
        ? { ...item, balance: (BigInt(item.balance) / HEDERA_WEIBAR_TO_TINYBAR).toString() }
        : item,
    ),
  }
}

// `isHedera` is passed in (rather than a chainId this module would check itself) so this stays
// agnostic to how a caller determines that — normally `hasFeature(chain, FEATURES.HEDERA)`
// against the CGW-provided chain config, which callers already have on hand.
export const createPortfolioBalances = (balances: Balances, isHedera?: boolean): PortfolioBalances => {
  const corrected = withHederaNativeBalance(balances, isHedera)
  return {
    ...corrected,
    tokensFiatTotal: corrected.fiatTotal,
    positionsFiatTotal: '0',
    positions: undefined,
  }
}

export const transformPortfolioToBalances = (portfolio?: Portfolio): PortfolioBalances | undefined => {
  if (!portfolio) return undefined

  return {
    items: portfolio.tokenBalances.map((token) => ({
      tokenInfo: {
        ...token.tokenInfo,
        logoUri: token.tokenInfo.logoUri || '',
      },
      balance: token.balance,
      fiatBalance: token.balanceFiat || '0',
      fiatConversion: token.price || '0',
      fiatBalance24hChange: token.priceChangePercentage1d,
    })),
    fiatTotal: portfolio.totalBalanceFiat,
    tokensFiatTotal: portfolio.totalTokenBalanceFiat,
    positionsFiatTotal: portfolio.totalPositionsBalanceFiat,
    positions: portfolio.positionBalances,
  }
}

export const calculateTokensFiatTotal = (items: Balances['items']): string => {
  const total = items.reduce((sum, item) => sum + parseFloat(item.fiatBalance || '0'), 0)
  return total.toString()
}
