// Stands in for DfnsApiClient, signing with local HD keys. Shapes follow @dfns/sdk 0.8.x.
import { HDNodeWallet, Signature, Transaction, TypedDataEncoder, getBytes, hashAuthorization, hashMessage } from 'ethers'

export class FakeDfnsClient {
  constructor (mnemonic) {
    this.root = HDNodeWallet.fromPhrase(mnemonic, undefined, 'm')
    this.keys = [{ id: 'key-master', masterKey: true, scheme: 'ECDSA', curve: 'secp256k1' }]
    this.wallets = []
    this.calls = []
    let n = 0
    const self = this
    this.keys.listKeys = async () => { self.calls.push('listKeys'); return { items: self.keys.map(({ id, masterKey }) => ({ id, masterKey })) } }
    this.keys.getKey = async ({ keyId }) => { self.calls.push('getKey'); return self.keys.find(k => k.id === keyId) }
    this.wallets.listWallets = async () => ({ items: self.wallets })
    this.wallets.getWallet = async ({ walletId }) => { self.calls.push('getWallet'); const w = self.wallets.find(w => w.id === walletId); if (!w) throw new Error('wallet not found'); return w }
    this.wallets.createWallet = async ({ body }) => {
      self.calls.push('createWallet')
      const path = body.signingKey?.deriveFrom?.path
      if (path && self.keys.some(k => k.store?.derivationPath === path)) throw new Error('duplicate derivation path')
      const node = path ? self.root.derivePath(path.slice(2)) : HDNodeWallet.createRandom()
      const key = { id: `key-${++n}`, masterKey: false, publicKey: node.publicKey.slice(2), store: { derivationPath: path }, wallets: [], _node: node }
      const wallet = { id: `wa-${n}`, network: body.network, address: node.address.toLowerCase(), status: 'Active', signingKey: { id: key.id, publicKey: key.publicKey } }
      key.wallets.push({ id: wallet.id, network: wallet.network }); self.keys.push(key); self.wallets.push(wallet)
      return wallet
    }
    this.wallets.generateSignature = async ({ walletId, body }) => {
      self.calls.push('generateSignature:' + body.kind)
      const w = self.wallets.find(w => w.id === walletId)
      const node = self.keys.find(k => k.id === w.signingKey.id)._node
      const sig = (digest) => { const s = node.signingKey.sign(digest); return { r: s.r, s: s.s, recid: s.yParity, encoded: s.serialized } }
      switch (body.kind) {
        case 'Eip191': return { status: 'Signed', signature: sig(hashMessage(getBytes(body.message))) }
        case 'Eip712': { if (body.types.EIP712Domain) throw new Error('ambiguous primary types'); return { status: 'Signed', signature: sig(TypedDataEncoder.hash(body.domain, body.types, body.message)) } }
        case 'Eip7702': return { status: 'Signed', signature: sig(hashAuthorization({ address: body.address, nonce: body.nonce, chainId: body.chainId })) }
        case 'Transaction': { const tx = Transaction.from(body.transaction); tx.signature = Signature.from(node.signingKey.sign(tx.unsignedHash)); return { status: 'Signed', signature: sig(tx.unsignedHash), signedData: tx.serialized } }
        default: throw new Error('unsupported kind ' + body.kind)
      }
    }
  }
}
