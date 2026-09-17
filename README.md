# wdk-signer-dfns-evm

A [Dfns](https://www.dfns.co) signer for the Tether WDK. It implements the `ISignerEvm` contract
from `@tetherto/wdk-wallet-evm`, so a WDK EVM wallet can sign with MPC keys held by Dfns. The WDK
itself is not modified. Companion of [wdk-signer-turnkey-evm](https://github.com/G9NCUE/wdk-signer-turnkey-evm),
same layout, other vendor.

On 11 September 2026 the demo below derived an account from a Dfns master key through the WDK,
signed a transfer with Dfns and broadcast it with the WDK:
[0x67420c3e…40d4e on Sepolia](https://sepolia.etherscan.io/tx/0x67420c3e4eccc23af1fb84ddce67b7ac6401ff6af6f9d459bc178814f2940d4e).
The account was funded by the Turnkey one from the other repo, one remote signer paying the other.

## Two ways to use it

Dfns has two key models and the signer supports both.

```js
import { DfnsApiClient } from '@dfns/sdk'
import { AsymmetricKeySigner } from '@dfns/sdk-keysigner'
import WalletManagerEvm from '@tetherto/wdk-wallet-evm'
import { DfnsSignerEvm } from 'wdk-signer-dfns-evm'

const client = new DfnsApiClient({ authToken, signer: new AsymmetricKeySigner({ credId, privateKey }) })

// 1. a master key: derivable root, each WDK account is a Dfns wallet derived from it
const wallet = new WalletManagerEvm(new DfnsSignerEvm({ client, masterKeyId, network: 'EthereumSepolia' }), { provider })
const account = await wallet.getAccount(0)      // Dfns wallet at m/44/60/0/0/0, created if it does not exist
await account.sendTransaction({ to, value })

// 2. one wallet: not derivable, registered by name
wallet.addSigner('treasury', new DfnsSignerEvm({ client, walletId }))
await wallet.getAccount('treasury')
```

Dfns only derives non-hardened paths, so the WDK path `0'/0/0` becomes `m/44/60/0/0/0` on the Dfns
side and the signer reports that full path. A second network on the same path reuses the derived key
(`signingKey.id`, needs the Keys:Reuse permission): one Dfns wallet per network, one address across EVM
chains. Disposing the root signer ends every account derived from it, since the WDK manager only
disposes accounts that hold a private key. `account.keyPair.privateKey` is always `null`.

## What goes to Dfns

| WDK call | Dfns call | Checked against the live API |
|---|---|---|
| `getAddress`, `derive` | `createWallet` with `signingKey.deriveFrom`, or `getWallet` | yes |
| `signTransaction` | `generateSignature` kind `Transaction`, unsigned RLP in, `signedData` out | yes, and broadcast |
| `signTypedData` | kind `Eip712`, domain, types, message | yes |
| `sign` (EIP-191) | kind `Eip191`, the message itself | yes |
| `signAuthorization` (EIP-7702) | kind `Eip7702`, address, nonce, chainId | yes |

Every payload reaches Dfns typed, nothing is hashed on this side, so Dfns policies can look at all
four. That is one difference with Turnkey, which sees messages and 7702 authorizations as digests.

## Running it

```sh
npm install
npm test                                # offline, a fake Dfns client backed by local HD keys
cp .env.example .env && chmod 600 .env  # token, credential id, path to the service account key
npm run example                         # each signer operation against Dfns, nothing broadcast
npm run demo                            # Sepolia: master key, account, funding, transfer, confirmation
npm run demo -- --fresh-key             # start by creating a new master key
npm run demo -- --dry-run               # sign the transfer but do not broadcast it
```

Dfns setup takes a few more steps than Turnkey. Create an organisation on https://app.dfns.io/get-started,
generate a P-256 key pair (`openssl ecparam -genkey -name prime256v1 -noout -out dfns-service-account.pem`,
then `openssl pkey -in dfns-service-account.pem -pubout`), create a service account under Settings,
Developers, with that public key, copy its token once, and give it a role with `Keys:Create`,
`Keys:ChildKeys:Create`, `Keys:Read`, `Wallets:Create`, `Wallets:Read` and `Keys:Signatures:Create`.
The demo prints the address to fund.

## Things I found

- Dfns does hierarchical derivation, which I did not expect. A key created with `masterKey: true`
  can derive children by path, and a wallet can be created on a derived key in one call.
- Paths are non-hardened only (`^m(/(0|[1-9]\d{0,9}))+$`).
- A second wallet at the same path fails with "duplicate derivation path" rather than returning the
  first one, and wallets do not expose their path. The derived key does, under `store.derivationPath`,
  so the signer lists keys to find an existing wallet.
- `createWallet` returns the address and the compressed public key in one go, no second call.
- Dfns rejects an `EIP712Domain` entry in `types` and infers the primary type. Turnkey accepts it.
- Addresses come back lower-case. The signer checksums them so they compare equal with what ethers
  recovers.
- Same as with Turnkey: `wdk-wallet-evm` beta.18 does not export `ISignerEvm`, so this extends the
  base `ISigner`, and `wdk-wallet-evm-erc-4337` cannot use a remote signer yet.

## Status

A prototype, not on npm. Apache-2.0 like the WDK.
