import * as fs from 'fs'
import * as zlib from 'zlib'
import { XtsDecryptor } from './xts'

/** Leitura com acesso aleatório. Todas as camadas (arquivo, XTS, PFS, PFSC) falam essa interface. */
export interface RandomReader {
  readonly size: number
  read(offset: number, length: number): Promise<Buffer>
}

/** Um trecho de um arquivo aberto (o PKG inteiro, ou só a imagem PFS dentro dele). */
export class FileSliceReader implements RandomReader {
  constructor(
    private readonly handle: fs.promises.FileHandle,
    private readonly base: number,
    readonly size: number
  ) {}

  async read(offset: number, length: number): Promise<Buffer> {
    if (offset < 0 || offset + length > this.size) {
      throw new Error('Leitura além do fim do arquivo (o PKG parece estar incompleto ou corrompido)')
    }
    const buffer = Buffer.allocUnsafe(length)
    let done = 0
    while (done < length) {
      const { bytesRead } = await this.handle.read(buffer, done, length - done, this.base + offset + done)
      if (bytesRead === 0) throw new Error('O arquivo terminou antes do esperado (PKG incompleto?)')
      done += bytesRead
    }
    return buffer
  }
}

/** Recorte de outro leitor (usado para arquivos contíguos dentro de um PFS). */
export class SliceReader implements RandomReader {
  constructor(
    private readonly inner: RandomReader,
    private readonly base: number,
    readonly size: number
  ) {}
  read(offset: number, length: number): Promise<Buffer> {
    if (offset < 0 || offset + length > this.size) throw new Error('Leitura além do fim do arquivo interno')
    return this.inner.read(this.base + offset, length)
  }
}

/** Descriptografa AES-XTS sob demanda. Setores antes de `startSector` não são criptografados. */
export class XtsReader implements RandomReader {
  constructor(
    private readonly inner: RandomReader,
    private readonly xts: XtsDecryptor,
    private readonly startSector: number,
    private readonly sectorSize = 0x1000
  ) {}

  get size(): number {
    return this.inner.size
  }

  async read(offset: number, length: number): Promise<Buffer> {
    if (length === 0) return Buffer.alloc(0)
    const S = this.sectorSize
    const first = Math.floor(offset / S)
    const last = Math.floor((offset + length - 1) / S)
    const rawStart = first * S
    const rawLength = Math.min((last - first + 1) * S, this.inner.size - rawStart)
    const raw = await this.inner.read(rawStart, rawLength)

    // O XTS trabalha em setores inteiros; o resto (se a imagem não for múltipla de 4 KiB) fica como está
    const firstCrypt = Math.max(first, this.startSector)
    const fullSectors = Math.floor(rawLength / S)
    const lastCrypt = Math.min(last, first + fullSectors - 1)
    if (firstCrypt <= lastCrypt) {
      const from = (firstCrypt - first) * S
      const to = (lastCrypt - first + 1) * S
      // Uint32Array precisa de início alinhado em 4 bytes
      const view =
        (raw.byteOffset + from) % 4 === 0 ? raw.subarray(from, to) : Buffer.from(raw.subarray(from, to))
      this.xts.decrypt(view, firstCrypt)
      if (view.buffer !== raw.buffer || view.byteOffset !== raw.byteOffset + from) view.copy(raw, from)
    }
    return raw.subarray(offset - rawStart, offset - rawStart + length)
  }
}

/** Arquivo cujos blocos não estão em sequência: converte posição lógica em posição física. */
export class BlockListReader implements RandomReader {
  constructor(
    private readonly inner: RandomReader,
    private readonly blockSize: number,
    private readonly blocks: number[],
    readonly size: number
  ) {}

  async read(offset: number, length: number): Promise<Buffer> {
    if (offset < 0 || offset + length > this.size) throw new Error('Leitura além do fim do arquivo interno')
    const out = Buffer.allocUnsafe(length)
    let done = 0
    while (done < length) {
      const position = offset + done
      const blockIndex = Math.floor(position / this.blockSize)
      const within = position - blockIndex * this.blockSize
      // junta blocos vizinhos na mesma leitura
      let run = 1
      while (
        blockIndex + run < this.blocks.length &&
        this.blocks[blockIndex + run] === this.blocks[blockIndex] + run &&
        (run + 1) * this.blockSize - within < length - done
      ) {
        run++
      }
      const chunk = Math.min(run * this.blockSize - within, length - done)
      const data = await this.inner.read(this.blocks[blockIndex] * this.blockSize + within, chunk)
      data.copy(out, done)
      done += chunk
    }
    return out
  }
}

const PFSC_MAGIC = 0x43534650

/** Imagem PFSC: o PFS interno guardado em blocos comprimidos (deflate). */
export class PfscReader implements RandomReader {
  readonly size: number
  private cache: { index: number; data: Buffer } | null = null

  private constructor(
    private readonly inner: RandomReader,
    private readonly blockSize: number,
    private readonly sectorMap: number[],
    dataLength: number
  ) {
    this.size = dataLength
  }

  static async isPfsc(reader: RandomReader): Promise<boolean> {
    if (reader.size < 0x30) return false
    return (await reader.read(0, 4)).readInt32LE(0) === PFSC_MAGIC
  }

  static async open(inner: RandomReader): Promise<PfscReader> {
    const header = await inner.read(0, 0x30)
    if (header.readInt32LE(0) !== PFSC_MAGIC) throw new Error('Imagem interna não é PFSC (assinatura ausente)')
    const blockSize = header.readInt32LE(0x0c)
    const blockSize2 = Number(header.readBigInt64LE(0x10))
    const blockOffsets = Number(header.readBigInt64LE(0x18))
    const dataLength = Number(header.readBigInt64LE(0x28))
    if (blockSize <= 0 || blockSize !== blockSize2) throw new Error('PFSC inválido (tamanho de bloco inconsistente)')
    const blocks = Math.floor(dataLength / blockSize2)
    const raw = await inner.read(blockOffsets, (blocks + 1) * 8)
    const sectorMap: number[] = []
    for (let i = 0; i <= blocks; i++) sectorMap.push(Number(raw.readBigInt64LE(i * 8)))
    return new PfscReader(inner, blockSize, sectorMap, dataLength)
  }

  private decodeBlock(index: number, compressed: Buffer | null, compressedSize: number): Buffer {
    const { blockSize } = this
    if (compressedSize === blockSize) return compressed!.subarray(0, blockSize)
    if (compressedSize > blockSize || compressedSize <= 2) return Buffer.alloc(blockSize)
    // 2 bytes de cabeçalho zlib + deflate cru (o rodapé adler32, se houver, é ignorado)
    const out = zlib.inflateRawSync(compressed!.subarray(2, compressedSize), {
      finishFlush: zlib.constants.Z_SYNC_FLUSH
    })
    if (out.length === blockSize) return out
    const padded = Buffer.alloc(blockSize)
    out.copy(padded, 0, 0, Math.min(out.length, blockSize))
    return padded
  }

  async read(offset: number, length: number): Promise<Buffer> {
    if (offset < 0 || offset + length > this.size) throw new Error('Leitura além do fim da imagem PFSC')
    if (length === 0) return Buffer.alloc(0)
    const { blockSize, sectorMap } = this
    const first = Math.floor(offset / blockSize)
    const last = Math.floor((offset + length - 1) / blockSize)

    // Uma leitura só para todos os blocos comprimidos pedidos (eles ficam em sequência)
    const spanStart = sectorMap[first]
    const spanEnd = sectorMap[last + 1]
    const span = spanEnd > spanStart ? await this.inner.read(spanStart, spanEnd - spanStart) : Buffer.alloc(0)

    const out = Buffer.allocUnsafe(length)
    let written = 0
    for (let index = first; index <= last; index++) {
      let block: Buffer
      if (this.cache && this.cache.index === index) {
        block = this.cache.data
      } else {
        const start = sectorMap[index] - spanStart
        const size = sectorMap[index + 1] - sectorMap[index]
        block = this.decodeBlock(index, size > 0 ? span.subarray(start, start + size) : null, size)
        this.cache = { index, data: block }
      }
      const from = index === first ? offset - first * blockSize : 0
      const to = Math.min(blockSize, offset + length - index * blockSize)
      block.copy(out, written, from, to)
      written += to - from
    }
    return out
  }
}
