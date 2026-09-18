/**
 * Hedera chain ids, kept free of @hashgraph/hedera-wallet-connect imports so weight-sensitive
 * modules (e.g. utils/wallets.ts in the main bundle) can check the chain cheaply.
 * Single source of truth lives in @safe-global/utils.
 */
export { HEDERA_CHAIN_IDS, isHederaChain } from '@safe-global/utils/utils/chains'
