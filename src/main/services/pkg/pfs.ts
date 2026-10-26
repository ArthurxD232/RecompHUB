import * as crypto from 'crypto'
import { BlockListReader, RandomReader, SliceReader, XtsReader } from './readers'
import { XtsDecryptor } from './xts'

/**
 * Leitor de imagens PFS (o sistema de arquivos dentro de um PKG do PS4).
 * Estrutura baseada na documentação pública do formato (PS4PFS.bt / LibOrbisPkg).
 */

const MODE_SIGNED = 0x1
const MODE_ENCRYPTED = 0x4
const NEW_CRYPT_FLAG = 0x2000000000000000n
const DIRENT_FILE = 2
const DIRENT_DIR = 3
const MAX_BLOCKS = 100_000_000

export interface PfsFile {
  /** caminho relativo à "uroot", com "/" */
  path: string
  size: number
  /** posição no disco (arquivos contíguos) */
  offset: number
  /** lista de blocos quando o arquivo não é contíguo */
  blocks: number[] | null
}

interface Dinode {
  size: number
  blocks: number
  startBlock: number
  directBlocks: number[]
  indirectBlocks: number[]
}

/** HMAC-SHA256(chave, índice LE32 || semente) */
function pfsGenCryptoKey(key: Buffer, seed: Buffer, index: number): Buffer {
  const data = Buffer.alloc(4 + seed.length)
  data.writeUInt32LE(index, 0)
  seed.copy(data, 4)
  return crypto.createHmac('sha256', key).update(data).digest()
}

/** Par de chaves (tweak, dados) do AES-XTS a partir do EKPFS e da semente do cabeçalho PFS. */
export function pfsGenEncKey(ekpfs: Buffer, seed: Buffer, newCrypt: boolean): { tweakKey: Buffer; dataKey: Buffer } {
  const base = newCrypt ? crypto.createHmac('sha256', ekpfs).update(seed).digest() : ekpfs
  const encKey = pfsGenCryptoKey(base, seed, 1)
  return { tweakKey: encKey.subarray(0, 16), dataKey: encKey.subarray(16, 32) }
}

export class PfsImage {
  private constructor(
    private readonly reader: RandomReader,
    readonly blockSize: number,
    readonly files: PfsFile[],
    private readonly signed: boolean
  ) {}

  /** Abre uma imagem PFS. `ekpfs` só é necessário se a imagem for criptografada. */
  static async open(raw: RandomReader, options: { ekpfs?: Buffer; pfsFlags?: bigint } = {}): Promise<PfsImage> {
    const header = await raw.read(0, 0x400)
    const version = header.readBigInt64LE(0)
    const magic = header.readBigInt64LE(8)
    if (version !== 1n || magic !== 20130315n) {
      throw new Error('Imagem PFS inválida: assinatura não confere (chaves erradas ou arquivo corrompido)')
    }
    const mode = header.readUInt16LE(0x1c)
    const blockSize = header.readUInt32LE(0x20)
    const dinodeCount = Number(header.readBigInt64LE(0x30))
    const dinodeBlockCount = Number(header.readBigInt64LE(0x40))
    const seed = header.subarray(0x370, 0x380)
    if (blockSize < 0x1000 || blockSize > 0x1000000 || blockSize % 0x1000 !== 0) {
      throw new Error('Imagem PFS inválida (tamanho de bloco estranho)')
    }

    let reader = raw
    if (mode & MODE_ENCRYPTED) {
      if (!options.ekpfs) throw new Error('A imagem PFS é criptografada, mas não há chave para abri-la')
      const newCrypt = ((options.pfsFlags ?? 0n) & NEW_CRYPT_FLAG) !== 0n
      const { tweakKey, dataKey } = pfsGenEncKey(options.ekpfs, Buffer.from(seed), newCrypt)
      reader = new XtsReader(raw, new XtsDecryptor(dataKey, tweakKey), blockSize / 0x1000, 0x1000)
    }

    const signed = (mode & MODE_SIGNED) !== 0
    const dinodeSize = signed ? 0x2c8 : 0xa8
    const perBlock = Math.floor(blockSize / dinodeSize)
    const dinodes: Dinode[] = []
    for (let i = 0; i < dinodeBlockCount && dinodes.length < dinodeCount; i++) {
      const block = await reader.read(blockSize + blockSize * i, blockSize)
      for (let j = 0; j < perBlock && dinodes.length < dinodeCount; j++) {
        dinodes.push(PfsImage.parseDinode(block, j * dinodeSize, signed))
      }
    }
    if (dinodes.length === 0) throw new Error('Imagem PFS sem inodes')

    const image = new PfsImage(reader, blockSize, [], signed)
    const files = await image.loadTree(dinodes)
    return new PfsImage(reader, blockSize, files, signed)
  }

  private static parseDinode(buf: Buffer, o: number, signed: boolean): Dinode {
    const size = Number(buf.readBigInt64LE(o + 0x08))
    const blocks = buf.readUInt32LE(o + 0x60)
    const directBlocks: number[] = []
    const indirectBlocks: number[] = []
    if (signed) {
      // 12 blocos diretos e 5 indiretos, cada um com assinatura de 32 bytes + número do bloco (int32)
      for (let i = 0; i < 12; i++) directBlocks.push(buf.readInt32LE(o + 0x64 + i * 36 + 32))
      for (let i = 0; i < 5; i++) indirectBlocks.push(buf.readInt32LE(o + 0x64 + 12 * 36 + i * 36 + 32))
    } else {
      for (let i = 0; i < 12; i++) directBlocks.push(buf.readInt32LE(o + 0x64 + i * 4))
      for (let i = 0; i < 5; i++) indirectBlocks.push(buf.readInt32LE(o + 0x64 + 12 * 4 + i * 4))
    }
    return { size, blocks, startBlock: directBlocks[0], directBlocks, indirectBlocks }
  }

  private async loadTree(dinodes: Dinode[]): Promise<PfsFile[]> {
    const files: PfsFile[] = []
    const rootDirents = await this.readDirents(dinodes, 0)
    const uroot = rootDirents.find((d) => d.type === DIRENT_DIR && d.name === 'uroot')
    if (!uroot) throw new Error('Imagem PFS inválida (não tem a pasta uroot)')

    const walk = async (inodeNumber: number, prefix: string): Promise<void> => {
      for (const dirent of await this.readDirents(dinodes, inodeNumber)) {
        if (dirent.type === DIRENT_FILE) {
          const inode = dinodes[dirent.inode]
          files.push({
            path: prefix + dirent.name,
            size: inode.size,
            offset: inode.startBlock * this.blockSize,
            blocks: await this.fileBlocks(dinodes, dirent.inode)
          })
        } else if (dirent.type === DIRENT_DIR) {
          await walk(dirent.inode, `${prefix}${dirent.name}/`)
        }
      }
    }
    await walk(uroot.inode, '')
    return files
  }

  private async readDirents(
    dinodes: Dinode[],
    inodeNumber: number
  ): Promise<{ inode: number; type: number; name: string }[]> {
    const inode = dinodes[inodeNumber]
    if (!inode || inode.blocks < 1 || inode.startBlock < 1 || inode.startBlock > MAX_BLOCKS || inode.blocks > MAX_BLOCKS) {
      throw new Error(`Inode ${inodeNumber} corrompido no PFS`)
    }
    const result: { inode: number; type: number; name: string }[] = []
    for (let b = 0; b < inode.blocks; b++) {
      const block = await this.reader.read((inode.startBlock + b) * this.blockSize, this.blockSize)
      let position = 0
      while (position + 16 <= block.length) {
        const entSize = block.readInt32LE(position + 12)
        if (entSize <= 0) break
        const type = block.readInt32LE(position + 4)
        const nameLength = block.readInt32LE(position + 8)
        const name = block.toString('latin1', position + 16, position + 16 + nameLength)
        result.push({ inode: block.readUInt32LE(position), type, name })
        position += entSize
      }
    }
    return result
  }

  /** Lista de blocos de um arquivo, ou null quando ele é contíguo (o caso comum). */
  private async fileBlocks(dinodes: Dinode[], inodeNumber: number): Promise<number[] | null> {
    const inode = dinodes[inodeNumber]
    if (!(inode.blocks > 1 && inode.directBlocks[1] !== -1)) return null
    if (!this.signed) throw new Error('PFS sem assinatura com blocos fora de ordem (formato não suportado)')

    const total = inode.blocks
    const blocks: number[] = new Array(total)
    const sigsPerBlock = Math.floor(this.blockSize / 36)
    let remaining = total
    for (let i = 0; i < 12 && i < remaining; i++) blocks[i] = inode.directBlocks[i]
    remaining -= 12
    let index = 12

    const readIndirect = async (blockNumber: number, count: number, store: (i: number, v: number) => void): Promise<void> => {
      const data = await this.reader.read(blockNumber * this.blockSize, this.blockSize)
      for (let i = 0; i < count; i++) store(i, data.readInt32LE(i * 36 + 32))
    }

    if (remaining > 0) {
      const count = Math.min(remaining, sigsPerBlock)
      await readIndirect(inode.indirectBlocks[0], count, (i, v) => (blocks[index + i] = v))
      remaining -= sigsPerBlock
      index += sigsPerBlock
    }
    for (let j = 0; remaining > 0; j++) {
      const first = await this.reader.read(inode.indirectBlocks[1] * this.blockSize, this.blockSize)
      const pointer = first.readInt32LE(j * 36 + 32)
      const count = Math.min(remaining, sigsPerBlock)
      await readIndirect(pointer, count, (i, v) => (blocks[index + i] = v))
      remaining -= sigsPerBlock
      index += sigsPerBlock
    }

    let contiguous = true
    for (let i = 1; i < blocks.length; i++) {
      if (blocks[i - 1] + 1 !== blocks[i]) {
        contiguous = false
        break
      }
    }
    return contiguous ? null : blocks
  }

  findFile(path: string): PfsFile | undefined {
    return this.files.find((f) => f.path === path)
  }

  /** Leitor do conteúdo de um arquivo da imagem. */
  fileReader(file: PfsFile): RandomReader {
    if (file.blocks) return new BlockListReader(this.reader, this.blockSize, file.blocks, file.size)
    return new SliceReader(this.reader, file.offset, file.size)
  }
}
