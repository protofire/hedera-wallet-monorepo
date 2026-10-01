import type { WalletInit } from '@web3-onboard/common'
import { createEIP1193Provider } from '@web3-onboard/common'
import type { Chain } from '@safe-global/store/gateway/AUTO_GENERATED/chains'
import type { SessionTypes } from '@walletconnect/types'
import { FEATURES, hasFeature } from '@safe-global/utils/utils/chains'
import { WC_PROJECT_ID } from '@/config/constants'
import { numberToHex } from '@/utils/hex'
import { getRpcServiceUrl } from '@/hooks/wallets/web3'
import { getHederaEvmAddress, getHederaContractId, getHederaEvmTransactionHash } from '@/utils/hedera'
import type { TransactionResponseJSON } from '@hiero-ledger/sdk'

export const HASHPACK_MODULE_LABEL = 'HashPack'

// Conservative default gas for a Safe's approveHash(bytes32) call — the only caller that never
// specifies its own gas (dispatchOnChainSigning); a real execution always supplies its own
// estimated gas via useGasLimit. Hedera has no eth_estimateGas equivalent for a not-yet-submitted
// native transaction, so a fixed ceiling is used here instead — mirrors the
// ZK_SYNC_ON_CHAIN_SIGNATURE_GAS_LIMIT precedent in services/tx/tx-sender/dispatch.ts for other
// chains needing an explicit override.
const DEFAULT_APPROVE_HASH_GAS = 200_000

const MIRROR_FETCH_TIMEOUT_MS = 10_000

const hexToBytes = (hex: string): Uint8Array => {
  const clean = hex.replace(/^0x/, '')
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/**
 * HashPack is reached over WalletConnect, not an injected provider — there is no
 * `window.hashpack` to wrap.
 *
 * Hedera owners always approve Safe transactions on-chain via `approveHash()` (see `signTx`
 * in `components/tx/shared/hooks.ts`). Hedera accounts can be ED25519- or ECDSA-keyed, and
 * only ECDSA accounts can ever produce an `ecrecover`-valid EVM signature — so this module
 * never requests an eip155/`eth_sendTransaction`-style WalletConnect method (HashPack blocks
 * ED25519 accounts from a session that requires one). Instead, the only signing method this
 * provider exposes, `eth_sendTransaction`, is translated internally into a native Hedera
 * `ContractExecuteTransaction` submitted via `hedera_signAndExecuteTransaction` — a
 * key-type-agnostic Hedera-native call that works for both ECDSA and ED25519 accounts.
 *
 * Everything else — every standard read-only EVM RPC method (`eth_call`, `eth_getCode`,
 * `eth_blockNumber`, `eth_getBalance`, `eth_gasPrice`, …) — is proxied straight to the chain's
 * own public RPC endpoint (Hashio). HashPack has no EVM JSON-RPC of its own to ask, and several
 * callers (web3-onboard's balance lookup, ethers' `BrowserProvider`, the Safe creation flow)
 * call these directly against a connected wallet's own provider, not just this app's separate
 * read-only provider — so this module needs to be able to answer them all, not just the ones
 * discovered so far.
 */
const HashPackModule = (chain: Chain): WalletInit => {
  return () => {
    // Only show HashPack for Hedera chains
    if (!hasFeature(chain, FEATURES.HEDERA) || !WC_PROJECT_ID) {
      return null
    }

    return {
      label: HASHPACK_MODULE_LABEL,
      getIcon: async () => (await import('./icon')).default,
      getInterface: async () => {
        const network = chain.isTestnet ? 'testnet' : 'mainnet'

        const [
          {
            DAppConnector,
            HederaChainId,
            HederaJsonRpcMethod,
            HederaSessionEvent,
            accountAndLedgerFromSession,
            transactionToBase64String,
          },
          { LedgerId, Client, ContractId, ContractExecuteTransaction, TransactionId },
        ] = await Promise.all([import('@hashgraph/hedera-wallet-connect'), import('@hiero-ledger/sdk')])

        const hederaChainId = network === 'mainnet' ? HederaChainId.Mainnet : HederaChainId.Testnet
        const ledgerId = network === 'mainnet' ? LedgerId.MAINNET : LedgerId.TESTNET

        const dAppConnector = new DAppConnector(
          {
            name: 'Safe{Wallet}',
            description: 'Safe{Wallet} — Hedera',
            url: window.location.origin,
            icons: [`${window.location.origin}/images/logo-round.svg`],
          },
          ledgerId,
          WC_PROJECT_ID,
          // Native Hedera methods only — never an eip155/ECDSA-only method (see module doc comment above).
          Object.values(HederaJsonRpcMethod),
          [HederaSessionEvent.ChainChanged, HederaSessionEvent.AccountsChanged],
          [hederaChainId],
        )

        await dAppConnector.init({ logger: 'error' })

        // A session's own account+ledger, not just the account — 0.0.123 on mainnet and 0.0.123
        // on testnet are unrelated accounts, so any code that trusts a session's account id must
        // also check it was actually paired against *this* ledger (see session restore below).
        const getAccountAndLedger = (s: SessionTypes.Struct) => {
          try {
            return accountAndLedgerFromSession(s)[0]
          } catch {
            return undefined
          }
        }

        const getAccountId = (s: SessionTypes.Struct): string | undefined => getAccountAndLedger(s)?.account?.toString()

        const resolveEvmAddress = async (s: SessionTypes.Struct): Promise<`0x${string}` | undefined> => {
          const accountId = getAccountId(s)
          if (!accountId) return undefined
          const evmAddress = await getHederaEvmAddress(network, accountId)
          return evmAddress as `0x${string}`
        }

        // Restore an already-approved session from a previous page load, if any — but only one
        // actually paired against *this* ledger. The underlying WalletConnect client/session
        // store is shared across every DAppConnector instantiated with the same project id, so a
        // session left over from Hedera mainnet must never be silently reused while viewing
        // testnet (or vice versa): the same account number can be a completely different, unrelated
        // account on each ledger.
        let session: SessionTypes.Struct | undefined = dAppConnector.walletConnectClient?.session.getAll().find((s) => {
          const entry = getAccountAndLedger(s)
          return !!entry && entry.network.toString() === ledgerId.toString()
        })

        const accountsChangedListeners = new Set<(accounts: string[]) => void>()
        const chainChangedListeners = new Set<(chainId: string) => void>()

        const client = dAppConnector.walletConnectClient
        client?.on('session_delete', (event) => {
          if (session?.topic === event.topic) {
            session = undefined
            accountsChangedListeners.forEach((listener) => listener([]))
          }
        })
        client?.on('session_event', (event) => {
          const activeSession = session
          if (activeSession?.topic !== event.topic) return
          const { name } = event.params.event
          if (name === 'accountsChanged') {
            resolveEvmAddress(activeSession).then((address) => {
              accountsChangedListeners.forEach((listener) => listener(address ? [address] : []))
            })
          }
          if (name === 'chainChanged') {
            chainChangedListeners.forEach((listener) => listener(numberToHex(Number(chain.chainId))))
          }
        })

        // Various callers — web3-onboard's own getBalance() helper, ethers' BrowserProvider
        // (network detection, gas estimation, tx-wait polling), and the Safe creation flow —
        // all call standard read-only EVM JSON-RPC methods (eth_call, eth_getCode,
        // eth_blockNumber, eth_getBlockByNumber, eth_gasPrice, eth_maxPriorityFeePerGas, etc.)
        // directly against a connected wallet's own provider, not just this app's separate
        // read-only provider. HashPack itself can't answer any of these (it only understands
        // native Hedera methods), so proxy anything not explicitly overridden below to the
        // chain's own public RPC endpoint (Hashio) — a real EVM-compatible JSON-RPC relay.
        const rpcUrl = getRpcServiceUrl(chain.rpcUri)
        const rpcRequest = async (method: string, params: unknown[] = []): Promise<unknown> => {
          const response = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
            signal: AbortSignal.timeout(MIRROR_FETCH_TIMEOUT_MS),
          })
          // Hashio can return a non-JSON error body (e.g. an HTML 502 page) for outages — check
          // the status first so that case surfaces as a clear RPC error, not a JSON parse error.
          if (!response.ok) {
            throw new Error(`Hedera RPC endpoint returned HTTP ${response.status} for ${method}`)
          }
          const { result, error } = (await response.json()) as { result?: unknown; error?: { message: string } }
          if (error) {
            throw new Error(error.message)
          }
          return result
        }

        // findExtensions() (called inside the DAppConnector constructor above) populates
        // dAppConnector.extensions asynchronously via a postMessage round trip with the
        // extension's own content script — poll briefly rather than assuming it's already
        // settled by the time the user clicks "HashPack" (it normally is, but this call can
        // race construction if it happens right after page load). Bounded-attempts, same shape
        // as the mirror-node polling in getHederaEvmTransactionHash (utils/hedera.ts).
        const EXTENSION_DETECT_ATTEMPTS = 8
        const EXTENSION_DETECT_POLL_MS = 100

        const findHashPackExtension = async () => {
          for (let attempt = 0; attempt < EXTENSION_DETECT_ATTEMPTS; attempt++) {
            const found =
              dAppConnector.extensions.find((ext) => ext.available && /hashpack/i.test(ext.name ?? '')) ??
              dAppConnector.extensions.find((ext) => ext.available)
            if (found) return found
            await new Promise((resolve) => setTimeout(resolve, EXTENSION_DETECT_POLL_MS))
          }
          return undefined
        }

        const connect = async (): Promise<[`0x${string}`]> => {
          // Prefer connecting directly to an installed HashPack browser extension — it skips
          // WalletConnect's own generic QR/wallet-picker modal entirely (which otherwise shows
          // HashPack redundantly a second time) and goes straight to the extension's own
          // approval popup. Only fall back to the modal when no extension is detected (e.g. no
          // HashPack installed, or a mobile browser).
          const extension = await findHashPackExtension()
          session = extension ? await dAppConnector.connectExtension(extension.id) : await dAppConnector.openModal()
          const address = await resolveEvmAddress(session)
          if (!address) {
            throw new Error('HashPack did not approve a usable Hedera session. Please update HashPack and try again.')
          }
          return [address]
        }

        const sendApproveHashTransaction = async (params: {
          from?: string
          to: string
          data: string
          gas?: string | number
          value?: string
        }): Promise<string> => {
          if (!session) {
            throw new Error('HashPack not connected')
          }
          const accountId = getAccountId(session)
          if (!accountId) {
            throw new Error('HashPack not connected')
          }

          // The tx is always paid/signed by the connected session's own account — fail closed
          // rather than silently signing from a different account than the caller believes it's
          // requesting from, if the two ever diverge (e.g. a stale request racing an account switch).
          if (params.from) {
            const fromAddress = await resolveEvmAddress(session)
            if (!fromAddress || fromAddress.toLowerCase() !== params.from.toLowerCase()) {
              throw new Error('HashPack account mismatch: the connected account no longer matches this request')
            }
          }

          // Safe's own execTransaction/approveHash calls are never sent with an attached value —
          // the Safe's own balance funds any inner transfer, not the caller's tx value — so this
          // should never actually be reached. Fail loudly instead of silently dropping a nonzero
          // value we don't otherwise support/convert (see hedera.ts: Hedera's EVM value semantics
          // are tinybar-native, NOT the weibar convention eth_sendTransaction callers normally use).
          if (params.value && BigInt(params.value) !== 0n) {
            throw new Error('HashPack: sending a native value alongside a contract call is not supported')
          }

          const gas = params.gas ? Number(params.gas) : DEFAULT_APPROVE_HASH_GAS

          // ContractId.fromEvmAddress() encodes both a contractNum (0) and an evmAddress on the
          // id, which relies on a protobuf `oneof` that doesn't reliably survive a serialize →
          // WalletConnect → deserialize round trip — HashPack ends up signing a transaction
          // targeting contract 0.0.0 instead of the intended one. Resolve the real native
          // contractNum-based id via the mirror node instead; see utils/hedera.ts for details.
          const contractId = await getHederaContractId(network, params.to)

          // Client.forName() has no operator account configured, so freezeWith can't
          // auto-derive a payer/TransactionId the way it would with a real client — it must be
          // set explicitly first (mirrors DAppSigner.populateTransaction's own internal pattern).
          const tx = new ContractExecuteTransaction()
            .setContractId(ContractId.fromString(contractId))
            .setGas(gas)
            .setFunctionParameters(hexToBytes(params.data))
            .setTransactionId(TransactionId.generate(accountId))
            .freezeWith(Client.forName(network))

          // The library's declared `SignAndExecuteTransactionResult` type wraps this in a full
          // JSON-RPC envelope (`{ id, jsonrpc, result }`), but the underlying WalletConnect
          // `signClient.request()` already unwraps it — DAppConnector/DAppSigner's own internal
          // code (dist/lib/dapp/DAppSigner.js) destructures fields directly with no `.result`,
          // confirming the declared type doesn't match the actual runtime shape.
          const result = (await dAppConnector.signAndExecuteTransaction({
            signerAccountId: `${hederaChainId}:${accountId}`,
            transactionList: transactionToBase64String(tx),
          })) as unknown as TransactionResponseJSON

          // `result.transactionHash` is Hedera's own SHA-384 transaction hash — a different
          // value entirely from the keccak-based hash EVM tooling (ethers' BrowserProvider
          // polling eth_getTransactionByHash to confirm a deployment, in particular) expects
          // back from eth_sendTransaction. Resolve the real EVM-equivalent hash instead.
          return getHederaEvmTransactionHash(network, result.transactionId)
        }

        return {
          provider: createEIP1193Provider(
            {
              on: (event: string, listener: (...args: unknown[]) => void) => {
                if (event === 'accountsChanged') {
                  accountsChangedListeners.add(listener as (accounts: string[]) => void)
                }
                if (event === 'chainChanged') {
                  chainChangedListeners.add(listener as (chainId: string) => void)
                }
              },

              // createEIP1193Provider (@web3-onboard/common) only patches `.request` onto this
              // object and returns it as-is — it does not add removeListener/off itself, so a
              // caller that tears down its own listeners on unmount/reconnect (e.g. ethers'
              // BrowserProvider) needs a real implementation here, not just `on`.
              removeListener: (event: string, listener: (...args: unknown[]) => void) => {
                if (event === 'accountsChanged') {
                  accountsChangedListeners.delete(listener as (accounts: string[]) => void)
                }
                if (event === 'chainChanged') {
                  chainChangedListeners.delete(listener as (chainId: string) => void)
                }
              },

              request: async ({ method, params }: { method: string; params?: unknown[] }) => rpcRequest(method, params),

              disconnect: async () => {
                if (session) {
                  await dAppConnector.disconnect(session.topic).catch(() => undefined)
                  session = undefined
                }
              },
            },
            {
              eth_chainId: async () => numberToHex(Number(chain.chainId)),
              eth_accounts: async () => {
                const address = session && (await resolveEvmAddress(session))
                return address ? [address] : []
              },
              eth_requestAccounts: async () => {
                const address = session && (await resolveEvmAddress(session))
                return address ? [address] : connect()
              },
              // @ts-expect-error — onboard types expect specific params
              eth_sendTransaction: async ({
                params,
              }: {
                params: [{ from?: string; to: string; data: string; gas?: string; value?: string }]
              }) => {
                if (!session) {
                  await connect()
                }
                return sendApproveHashTransaction(params[0])
              },
            },
          ),
        }
      },
      platforms: ['desktop'],
    }
  }
}

export default HashPackModule
