'use strict'

import { ISigner, InvalidSignerError, ValueError } from '@tetherto/wdk-wallet'
import { Signature, Transaction, TypedDataEncoder, getAddress, getBytes, hexlify, toUtf8Bytes } from 'ethers'

const PATH_PREFIX = '44/60'
const DEFAULT_PATH = '0/0/0'

// Follows the ISignerEvm contract by shape: wdk-wallet-evm beta.18 does not export the class.
// Two modes: { walletId } binds one Dfns wallet and cannot derive; { masterKeyId, network } is a
// derivable root, each child is a Dfns wallet derived from the master key at a non-hardened path.
export default class DfnsSignerEvm extends ISigner {
  // client is a DfnsApiClient from @dfns/sdk with a credential signer
  constructor ({ client, walletId, masterKeyId, network, path = DEFAULT_PATH, isChild = false } = {}) {
    super()
    if (!client) throw new ValueError('A Dfns API client is required.')
    if (!walletId && !(masterKeyId && network)) throw new ValueError('Pass a walletId, or a masterKeyId and a network.')
    this._client = client
    this._walletId = walletId
    this._masterKeyId = masterKeyId
    this._network = network
    // Dfns only derives non-hardened paths, so hardened markers are dropped
    this._path = walletId ? undefined : `${PATH_PREFIX}/${path.replace(/'/g, '')}`
    this._isChild = isChild
    this._address = undefined
    this._publicKey = null
  }

  static async connect (opts) {
    const signer = new DfnsSignerEvm(opts)
    await signer.getAddress()
    return signer
  }

  get isDerivable () { return Boolean(this._masterKeyId) && !this._isChild }
  get index () { return this._path ? +this._path.split('/').pop() : undefined }
  get path () { return this._path }
  get address () { return this._address }
  get keyPair () { return { privateKey: null, publicKey: this._publicKey } }

  async derive (relPath) {
    if (!this.isDerivable) throw new InvalidSignerError('Cannot derive: this signer is bound to one wallet or is a derived child.')
    return new DfnsSignerEvm({ client: this._client, masterKeyId: this._masterKeyId, network: this._network, path: relPath, isChild: true })
  }

  async getAddress () {
    if (this._address) return this._address
    if (!this._client) throw new InvalidSignerError('The signer has been disposed.')

    const wallet = this._walletId
      ? await this._client.wallets.getWallet({ walletId: this._walletId })
      : await this._findOrCreateWallet()
    this._walletId = wallet.id
    this._address = getAddress(wallet.address)
    this._publicKey = wallet.signingKey?.publicKey ? getBytes(hex0x(wallet.signingKey.publicKey)) : null
    return this._address
  }

  async sign (message) {
    const { signature } = await this._sign({ kind: 'Eip191', message: hexlify(toUtf8Bytes(message)) })
    return signature.encoded
  }

  async signTransaction (unsignedTx) {
    const address = await this.getAddress()
    const { from, ...txLike } = unsignedTx
    if (from && from.toLowerCase() !== address.toLowerCase()) {
      throw new ValueError(`Transaction "from" (${from}) does not match the signer address (${address}).`)
    }
    const { signedData } = await this._sign({ kind: 'Transaction', transaction: Transaction.from(txLike).unsignedSerialized })
    return signedData
  }

  // Dfns infers the primary type and rejects an EIP712Domain entry in types
  async signTypedData ({ domain, types, message }) {
    const { EIP712Domain, ...rest } = TypedDataEncoder.getPayload(domain, types, message).types
    const { signature } = await this._sign({ kind: 'Eip712', types: rest, domain, message })
    return signature.encoded
  }

  async signAuthorization (auth) {
    const populated = { address: auth.address, nonce: BigInt(auth.nonce ?? 0), chainId: BigInt(auth.chainId ?? 0) }
    const { signature } = await this._sign({ kind: 'Eip7702', address: populated.address, nonce: Number(populated.nonce), chainId: Number(populated.chainId) })
    return { ...populated, signature: Signature.from(signature.encoded) }
  }

  dispose () {
    this._client = undefined
    this._publicKey = null
  }

  async _sign (body) {
    const res = await this._client.wallets.generateSignature({ walletId: await this._walletIdResolved(), body })
    if (res.status !== 'Signed') throw new InvalidSignerError(`Dfns did not sign (status ${res.status}${res.reason ? ': ' + res.reason : ''}).`)
    return res
  }

  async _walletIdResolved () {
    await this.getAddress()
    return this._walletId
  }

  // Dfns rejects a duplicate derivation path instead of returning the existing wallet,
  // and wallets do not expose their path; the derived key does, under store.derivationPath.
  async _findOrCreateWallet () {
    const path = `m/${this._path}`
    try {
      return await this._client.wallets.createWallet({
        body: { network: this._network, name: `wdk ${path}`, signingKey: { deriveFrom: { keyId: this._masterKeyId, path } } }
      })
    } catch (e) {
      if (!/duplicate derivation path/i.test(e.message)) throw e
    }
    const { items } = await this._client.keys.listKeys({})
    for (const k of items.filter(k => !k.masterKey)) {
      const key = await this._client.keys.getKey({ keyId: k.id })
      if (key.store?.derivationPath !== path) continue
      const w = key.wallets?.find(w => w.network === this._network)
      if (w) return this._client.wallets.getWallet({ walletId: w.id })
    }
    throw new InvalidSignerError(`No ${this._network} wallet found at ${path} on master key ${this._masterKeyId}.`)
  }
}

function hex0x (hex) {
  return hex.startsWith('0x') ? hex : `0x${hex}`
}
