import * as crypto from 'crypto'

/**
 * AES-128-XTS (IEEE 1619) feito só com AES-ECB.
 *
 * O Node que vem dentro do Electron usa BoringSSL, que NÃO tem o cifrador "aes-128-xts"
 * (só o Node comum, com OpenSSL, tem). Por isso o XTS é montado aqui por cima do AES-ECB,
 * que existe nos dois.
 *
 * Cada setor tem o seu "tweak" (número do setor, little-endian, cifrado com a chave de tweak)
 * que é multiplicado por alfa em GF(2^128) a cada bloco de 16 bytes.
 */
export class XtsDecryptor {
  private readonly dataDecipher: crypto.Decipher
  private readonly tweakCipher: crypto.Cipher
  private readonly tweaks: Uint32Array

  constructor(
    dataKey: Buffer,
    tweakKey: Buffer,
    private readonly sectorSize = 0x1000
  ) {
    if (dataKey.length !== 16 || tweakKey.length !== 16) {
      throw new Error('Chaves XTS devem ter 16 bytes')
    }
    this.dataDecipher = crypto.createDecipheriv('aes-128-ecb', dataKey, null)
    this.dataDecipher.setAutoPadding(false)
    this.tweakCipher = crypto.createCipheriv('aes-128-ecb', tweakKey, null)
    this.tweakCipher.setAutoPadding(false)
    this.tweaks = new Uint32Array(sectorSize / 4)
  }

  /** Descriptografa `buffer` no lugar. `firstSector` é o número do primeiro setor dele. */
  decrypt(buffer: Buffer, firstSector: number): void {
    const { sectorSize } = this
    if (buffer.length % sectorSize !== 0) throw new Error('Buffer precisa ser múltiplo do setor')
    const sectors = buffer.length / sectorSize
    const words = new Uint32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4)
    const wordsPerSector = sectorSize / 4
    const tweaks = this.tweaks

    // 1) tweaks de todos os setores + XOR antes do AES
    for (let s = 0; s < sectors; s++) {
      this.fillTweaks(firstSector + s)
      const base = s * wordsPerSector
      for (let i = 0; i < wordsPerSector; i++) words[base + i] ^= tweaks[i]
    }

    // 2) uma única chamada de AES-ECB para o buffer inteiro
    const decrypted = this.dataDecipher.update(buffer)
    decrypted.copy(buffer)

    // 3) XOR depois do AES (os tweaks são recalculados: custa menos do que guardar todos)
    for (let s = 0; s < sectors; s++) {
      this.fillTweaks(firstSector + s)
      const base = s * wordsPerSector
      for (let i = 0; i < wordsPerSector; i++) words[base + i] ^= tweaks[i]
    }
  }

  /** Preenche this.tweaks com os tweaks de cada bloco de 16 bytes do setor. */
  private fillTweaks(sectorNumber: number): void {
    const iv = Buffer.alloc(16)
    iv.writeBigUInt64LE(BigInt(sectorNumber), 0)
    const first = this.tweakCipher.update(iv)
    const t = this.tweaks
    t[0] = first.readUInt32LE(0)
    t[1] = first.readUInt32LE(4)
    t[2] = first.readUInt32LE(8)
    t[3] = first.readUInt32LE(12)
    const blocks = this.sectorSize / 16
    for (let b = 1; b < blocks; b++) {
      const p = (b - 1) * 4
      const q = b * 4
      // multiplicação por alfa: desloca 1 bit à esquerda (little-endian de 128 bits)
      const carry = t[p + 3] >>> 31
      t[q + 3] = ((t[p + 3] << 1) | (t[p + 2] >>> 31)) >>> 0
      t[q + 2] = ((t[p + 2] << 1) | (t[p + 1] >>> 31)) >>> 0
      t[q + 1] = ((t[p + 1] << 1) | (t[p] >>> 31)) >>> 0
      t[q] = ((t[p] << 1) >>> 0) ^ (carry ? 0x87 : 0)
    }
  }
}
