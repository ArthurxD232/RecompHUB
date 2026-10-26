import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { PkgKeys } from './keys'
import { PfsFile, PfsImage } from './pfs'
import { FileSliceReader, PfscReader, RandomReader } from './readers'
import { rsaPkcs1Decrypt } from './rsa'

/**
 * Leitura e extração de PKGs "fake" do PS4 (os que usam as chaves públicas conhecidas da cadeia de
 * "fake signing"). PKGs originais da loja (com chaves da Sony ligadas ao console) NÃO são suportados.
 * Estrutura do formato baseada na documentação pública (PS4PKG.bt / LibOrbisPkg).
 */

const PKG_MAGIC = 0x7f434e54 // "\x7FCNT"
const ENTRY_KEYS = 0x10
const IMAGE_KEY = 0x20
const PARAM_SFO = 0x1000

export type PkgKind = 'game' | 'patch' | 'addon' | 'delta'

export interface PkgInfo {
  file: string
  fileSize: number
  contentId: string
  titleId: string
  title: string
  category: string
  appVersion: string
  contentType: number
  kind: PkgKind
  pfsImageOffset: number
  pfsImageSize: number
}

interface MetaEntry {
  id: number
  nameOffset: number
  flags1: number
  flags2: number
  dataOffset: number
  dataSize: number
}

/** O PS4 grava os 6 campos em big-endian + 8 bytes zero: é isso que entra no cálculo da chave. */
function metaBytes(e: MetaEntry): Buffer {
  const buf = Buffer.alloc(32)
  buf.writeUInt32BE(e.id, 0)
  buf.writeUInt32BE(e.nameOffset, 4)
  buf.writeUInt32BE(e.flags1, 8)
  buf.writeUInt32BE(e.flags2, 12)
  buf.writeUInt32BE(e.dataOffset, 16)
  buf.writeUInt32BE(e.dataSize, 20)
  return buf
}

/** param.sfo: lê só os campos de texto/número que interessam. */
export function parseSfo(buf: Buffer): Record<string, string | number> {
  const result: Record<string, string | number> = {}
  if (buf.length < 20 || buf.readUInt32BE(0) !== 0x00505346) return result
  const keyTable = buf.readUInt32LE(8)
  const dataTable = buf.readUInt32LE(12)
  const count = buf.readUInt32LE(16)
  for (let i = 0; i < count; i++) {
    const o = 20 + i * 16
    if (o + 16 > buf.length) break
    const keyOffset = buf.readUInt16LE(o)
    const format = buf.readUInt16LE(o + 2)
    const length = buf.readUInt32LE(o + 4)
    const dataOffset = buf.readUInt32LE(o + 12)
    const keyStart = keyTable + keyOffset
    const keyEnd = buf.indexOf(0, keyStart)
    const key = buf.toString('utf8', keyStart, keyEnd < 0 ? buf.length : keyEnd)
    const start = dataTable + dataOffset
    if (format === 0x0404 && length >= 4) {
      result[key] = buf.readUInt32LE(start)
    } else {
      const end = buf.indexOf(0, start)
      result[key] = buf.toString('utf8', start, Math.min(end < 0 ? start + length : end, start + length))
    }
  }
  return result
}

function classify(contentType: number, category: string): PkgKind {
  if (contentType === 0x1e) return 'delta'
  if (contentType === 0x1b || contentType === 0x1c) return 'addon'
  if (category.toLowerCase() === 'gp') return 'patch'
  return 'game'
}

async function readHeaderAndEntries(reader: RandomReader): Promise<{
  info: Omit<PkgInfo, 'file' | 'fileSize' | 'title' | 'category' | 'appVersion' | 'titleId' | 'kind'>
  entries: MetaEntry[]
  pfsFlags: bigint
}> {
  if (reader.size < 0x1000) throw new Error('Arquivo pequeno demais para ser um PKG')
  const header = await reader.read(0, 0x1000)
  if (header.readUInt32BE(0) !== PKG_MAGIC) {
    throw new Error('Isto não é um PKG do PlayStation 4 (assinatura "CNT" ausente)')
  }
  const entryCount = header.readUInt32BE(0x10)
  const entryTableOffset = header.readUInt32BE(0x18)
  if (entryCount === 0 || entryCount > 4096) throw new Error('PKG com tabela de entradas inválida')

  const table = await reader.read(entryTableOffset, entryCount * 32)
  const entries: MetaEntry[] = []
  for (let i = 0; i < entryCount; i++) {
    const o = i * 32
    entries.push({
      id: table.readUInt32BE(o),
      nameOffset: table.readUInt32BE(o + 4),
      flags1: table.readUInt32BE(o + 8),
      flags2: table.readUInt32BE(o + 12),
      dataOffset: table.readUInt32BE(o + 16),
      dataSize: table.readUInt32BE(o + 20)
    })
  }

  const nul = header.indexOf(0, 0x40)
  return {
    info: {
      contentId: header.toString('ascii', 0x40, Math.min(nul < 0 ? 0x70 : nul, 0x70)),
      contentType: header.readUInt32BE(0x74),
      pfsImageOffset: Number(header.readBigUInt64BE(0x410)),
      pfsImageSize: Number(header.readBigUInt64BE(0x418))
    },
    entries,
    pfsFlags: header.readBigUInt64BE(0x408)
  }
}

/** Entradas protegidas: AES-128-CBC com chave/IV derivados de SHA256(meta || chave derivada 3). */
function decryptEntry(data: Buffer, meta: MetaEntry, dk3: Buffer): Buffer {
  const ivKey = crypto.createHash('sha256').update(metaBytes(meta)).update(dk3).digest()
  const decipher = crypto.createDecipheriv('aes-128-cbc', ivKey.subarray(16, 32), ivKey.subarray(0, 16))
  decipher.setAutoPadding(false)
  return Buffer.concat([decipher.update(data), decipher.final()])
}

/** Lê só as informações do PKG (nome do jogo, tipo, versão), sem precisar das chaves. */
export async function readPkgInfo(file: string): Promise<PkgInfo> {
  const handle = await fs.promises.open(file, 'r')
  try {
    const size = (await handle.stat()).size
    const reader = new FileSliceReader(handle, 0, size)
    const { info, entries } = await readHeaderAndEntries(reader)
    let sfo: Record<string, string | number> = {}
    const sfoEntry = entries.find((e) => e.id === PARAM_SFO)
    if (sfoEntry && (sfoEntry.flags1 & 0x80000000) === 0 && sfoEntry.dataSize < 1_000_000) {
      sfo = parseSfo(await reader.read(sfoEntry.dataOffset, sfoEntry.dataSize))
    }
    const category = String(sfo.CATEGORY ?? '')
    const titleId =
      String(sfo.TITLE_ID ?? '') || /-([A-Z]{4}\d{5})_/.exec(info.contentId)?.[1] || ''
    return {
      file,
      fileSize: size,
      title: String(sfo.TITLE ?? ''),
      titleId,
      category,
      appVersion: String(sfo.APP_VER ?? sfo.VERSION ?? ''),
      kind: classify(info.contentType, category),
      ...info
    }
  } finally {
    await handle.close()
  }
}

/** Ordem de aplicação ao juntar vários PKGs do mesmo jogo: base, depois patches por versão. */
export function sortForMerge(list: PkgInfo[]): PkgInfo[] {
  const rank = (k: PkgKind): number => (k === 'game' ? 0 : k === 'patch' ? 1 : 2)
  return [...list].sort(
    (a, b) =>
      rank(a.kind) - rank(b.kind) ||
      a.appVersion.localeCompare(b.appVersion, undefined, { numeric: true }) ||
      b.fileSize - a.fileSize
  )
}

export class PkgKeyError extends Error {}

/** Um PKG aberto: com a árvore de arquivos já lida, pronto para extrair. */
export class PkgSession {
  private constructor(
    readonly info: PkgInfo,
    private readonly handle: fs.promises.FileHandle,
    private readonly inner: PfsImage,
    private readonly innerReader: RandomReader,
    readonly files: PfsFile[]
  ) {}

  get totalBytes(): number {
    return this.files.reduce((sum, f) => sum + f.size, 0)
  }

  static async open(file: string, keys: PkgKeys): Promise<PkgSession> {
    const info = await readPkgInfo(file)
    if (info.kind === 'delta') {
      throw new Error(
        `"${path.basename(file)}" é um patch delta do PS4 (só funciona sobre o jogo instalado no console). Use um PKG completo ou um patch normal.`
      )
    }
    const handle = await fs.promises.open(file, 'r')
    try {
      const reader = new FileSliceReader(handle, 0, info.fileSize)
      const { entries, pfsFlags } = await readHeaderAndEntries(reader)
      const keysEntry = entries.find((e) => e.id === ENTRY_KEYS)
      const imageKeyEntry = entries.find((e) => e.id === IMAGE_KEY)
      if (!keysEntry || !imageKeyEntry) throw new Error('PKG sem as entradas de chave (arquivo corrompido?)')
      if (info.pfsImageSize === 0) throw new Error('PKG sem imagem de arquivos (PFS)')

      // ENTRY_KEYS: semente(32) + 7 digests(32) + 7 chaves RSA(256)
      const keysData = await reader.read(keysEntry.dataOffset, 32 + 7 * 32 + 7 * 256)
      const digests = (i: number): Buffer => keysData.subarray(32 + i * 32, 64 + i * 32)
      const encryptedKey = (i: number): Buffer => keysData.subarray(32 + 7 * 32 + i * 256, 32 + 7 * 32 + (i + 1) * 256)

      let ekpfs: Buffer
      try {
        const dk3 = rsaPkcs1Decrypt(encryptedKey(3), keys.pkgDerivedKey3)
        const imageKey = decryptEntry(await reader.read(imageKeyEntry.dataOffset, imageKeyEntry.dataSize), imageKeyEntry, dk3)
        ekpfs = rsaPkcs1Decrypt(imageKey, keys.fake)
      } catch (err: any) {
        throw new PkgKeyError(
          `As chaves informadas não abriram "${path.basename(file)}". Ele pode não ser um PKG "fake" (o único tipo suportado) ou o arquivo de chaves está incorreto. (${err?.message || err})`
        )
      }
      // Conferência forte: SHA256(ekpfs) XOR ekpfs tem que ser igual ao digest gravado no PKG
      const check = crypto.createHash('sha256').update(ekpfs).digest()
      for (let i = 0; i < 32; i++) check[i] ^= ekpfs[i]
      if (!check.equals(digests(1))) {
        throw new PkgKeyError(
          `As chaves informadas não conferem com "${path.basename(file)}" (verificação do EKPFS falhou). Confira o arquivo de chaves.`
        )
      }

      const pfsRaw = new FileSliceReader(handle, info.pfsImageOffset, info.pfsImageSize)
      const outer = await PfsImage.open(pfsRaw, { ekpfs, pfsFlags })
      const pfsImageDat = outer.findFile('pfs_image.dat')
      if (!pfsImageDat) throw new Error('PKG sem a imagem interna (pfs_image.dat)')
      const datReader = outer.fileReader(pfsImageDat)

      const innerReader = (await PfscReader.isPfsc(datReader)) ? await PfscReader.open(datReader) : datReader
      const inner = await PfsImage.open(innerReader)
      return new PkgSession(info, handle, inner, innerReader, inner.files)
    } catch (err) {
      await handle.close()
      throw err
    }
  }

  /**
   * Extrai todos os arquivos para `destDir` (arquivos já existentes são sobrescritos, que é o que
   * faz um patch valer por cima do jogo base).
   */
  async extractTo(
    destDir: string,
    onBytes?: (bytes: number, currentFile: string) => void,
    shouldStop?: () => boolean
  ): Promise<number> {
    const root = path.resolve(destDir)
    await fs.promises.mkdir(root, { recursive: true })
    const CHUNK = 4 * 1024 * 1024
    let count = 0

    for (const file of this.files) {
      if (shouldStop?.()) throw new Error('Extração cancelada')
      const outPath = safeJoin(root, file.path)
      if (!outPath) continue
      await fs.promises.mkdir(path.dirname(outPath), { recursive: true })

      const reader = this.inner.fileReader(file)
      const output = await fs.promises.open(outPath, 'w')
      try {
        let position = 0
        while (position < file.size) {
          const length = Math.min(CHUNK, file.size - position)
          const data = await reader.read(position, length)
          await output.write(data, 0, data.length)
          position += length
          onBytes?.(length, file.path)
        }
      } finally {
        await output.close()
      }
      count++
    }
    return count
  }

  async close(): Promise<void> {
    await this.handle.close().catch(() => undefined)
  }
}

/** Junta o caminho de dentro do PKG à pasta de destino sem deixar sair dela. */
function safeJoin(root: string, relative: string): string | null {
  const parts = relative
    .split('/')
    .filter((p) => p && p !== '.')
    .map((p) => p.replace(/[<>:"|?*\\\x00-\x1f]/g, '_'))
  if (parts.some((p) => p === '..')) return null
  const full = path.resolve(root, ...parts)
  return full.startsWith(root + path.sep) ? full : null
}

