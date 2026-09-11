import { readFileSync } from 'node:fs'
import { DfnsApiClient } from '@dfns/sdk'
import { AsymmetricKeySigner } from '@dfns/sdk-keysigner'

// Builds the Dfns client from the environment: DFNS_API_URL, DFNS_AUTH_TOKEN, DFNS_CRED_ID,
// and DFNS_PRIVATE_KEY (PEM) or DFNS_PRIVATE_KEY_FILE.
export function clientFromEnv (env = process.env) {
  const need = (k) => env[k] ?? (() => { throw new Error(`${k} is not set, see .env.example`) })()
  const privateKey = env.DFNS_PRIVATE_KEY ?? readFileSync(need('DFNS_PRIVATE_KEY_FILE'), 'utf8')
  return new DfnsApiClient({
    baseUrl: env.DFNS_API_URL || 'https://api.dfns.io',
    authToken: need('DFNS_AUTH_TOKEN'),
    signer: new AsymmetricKeySigner({ credId: need('DFNS_CRED_ID'), privateKey })
  })
}
