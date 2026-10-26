/**
 * RSA com BigInt (descriptografia PKCS#1 v1.5).
 *
 * Feito à mão porque versões recentes do Node recusam `privateDecrypt` com RSA_PKCS1_PADDING
 * (CVE-2023-46809) e porque assim o resultado não depende do OpenSSL/BoringSSL do runtime.
 */
export interface RsaPrivateKey {
  /** módulo */
  n: bigint
  /** expoente privado */
  d: bigint
}

export function bytesToBigInt(bytes: Buffer): bigint {
  return bytes.length === 0 ? 0n : BigInt('0x' + bytes.toString('hex'))
}

export function bigIntToBytes(value: bigint, length: number): Buffer {
  const hex = value.toString(16).padStart(length * 2, '0')
  if (hex.length > length * 2) throw new Error('Número grande demais para o tamanho pedido')
  return Buffer.from(hex, 'hex')
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n
  let b = base % modulus
  let e = exponent
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus
    e >>= 1n
    if (e > 0n) b = (b * b) % modulus
  }
  return result
}

/** Descriptografa um bloco RSA e remove o padding PKCS#1 v1.5 (tipo 2). */
export function rsaPkcs1Decrypt(ciphertext: Buffer, key: RsaPrivateKey): Buffer {
  const size = Math.ceil(key.n.toString(16).length / 2)
  if (ciphertext.length !== size) {
    throw new Error(`Bloco RSA com tamanho inesperado (${ciphertext.length} bytes, esperado ${size})`)
  }
  const plain = bigIntToBytes(modPow(bytesToBigInt(ciphertext), key.d, key.n), size)
  if (plain[0] !== 0x00 || plain[1] !== 0x02) {
    throw new Error('Padding RSA inválido (chave errada para este bloco)')
  }
  let i = 2
  while (i < plain.length && plain[i] !== 0x00) i++
  if (i >= plain.length || i < 10) throw new Error('Padding RSA inválido (chave errada para este bloco)')
  return plain.subarray(i + 1)
}
