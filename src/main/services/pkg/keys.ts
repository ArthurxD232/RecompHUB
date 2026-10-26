import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { RsaPrivateKey } from './rsa'

/**
 * Chaves para abrir PKGs "fake" do PS4.
 *
 * O RecompHUB NÃO inclui essas chaves: elas precisam vir do próprio usuário, num arquivo
 * `keys.json` no mesmo formato do shadPS4 (campos FakeKeyset e PkgDerivedKey3Keyset).
 */
export interface PkgKeys {
  fake: RsaPrivateKey
  pkgDerivedKey3: RsaPrivateKey
}

function hexToBigInt(value: unknown, field: string): bigint {
  if (typeof value !== 'string') throw new Error(`campo ${field} ausente`)
  const hex = value.replace(/^0x/i, '').replace(/[\s:]/g, '')
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
    throw new Error(`campo ${field} não é um número hexadecimal válido`)
  }
  return BigInt('0x' + hex)
}

function parseKeyset(raw: any, name: string): RsaPrivateKey {
  if (!raw || typeof raw !== 'object') throw new Error(`${name} ausente no arquivo de chaves`)
  try {
    const n = hexToBigInt(raw.Modulus, 'Modulus')
    const d = hexToBigInt(raw.PrivateExponent, 'PrivateExponent')
    if (n.toString(16).length < 500) throw new Error('Modulus deveria ter 2048 bits')
    return { n, d }
  } catch (err: any) {
    throw new Error(`${name}: ${err?.message || err}`)
  }
}

export function parsePkgKeys(jsonText: string): PkgKeys {
  let parsed: any
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new Error('O arquivo de chaves não é um JSON válido.')
  }
  return {
    fake: parseKeyset(parsed?.FakeKeyset, 'FakeKeyset'),
    pkgDerivedKey3: parseKeyset(parsed?.PkgDerivedKey3Keyset, 'PkgDerivedKey3Keyset')
  }
}

export function loadPkgKeysFile(file: string): PkgKeys {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf-8')
  } catch (err: any) {
    throw new Error(`Não foi possível ler o arquivo de chaves "${file}": ${err?.message || err}`)
  }
  return parsePkgKeys(text)
}

/** Lugares onde o shadPS4 costuma guardar o keys.json (para reaproveitar quem já o configurou). */
export function shadPs4KeysCandidates(): string[] {
  const home = os.homedir()
  const list = [
    path.join(home, '.local/share/shadPS4/keys.json'),
    path.join(home, '.local/share/shadps4/keys.json'),
    path.join(home, '.config/shadPS4/keys.json'),
    path.join(home, '.var/app/net.shadps4.shadPS4/data/shadPS4/keys.json'),
    path.join(home, 'Library/Application Support/shadPS4/keys.json')
  ]
  if (process.env.APPDATA) list.push(path.join(process.env.APPDATA, 'shadPS4', 'keys.json'))
  if (process.env.LOCALAPPDATA) list.push(path.join(process.env.LOCALAPPDATA, 'shadPS4', 'keys.json'))
  return list
}

/** Procura o arquivo de chaves: o escolhido pelo usuário primeiro, depois os lugares do shadPS4. */
export function findPkgKeysFile(configuredPath?: string): string | null {
  const candidates = [configuredPath, process.env.RECOMPHUB_PKG_KEYS, ...shadPs4KeysCandidates()]
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate
  }
  return null
}
