import * as fs from 'fs'
import * as path from 'path'
import { pipeline } from 'stream/promises'
import yauzl from 'yauzl'

/**
 * Utilitários para arquivos grandes (dumps de PS4/PS3/Wii U têm dezenas de GB).
 * Nada aqui lê um arquivo inteiro na memória: o Node recusa arquivos acima de 2 GiB em
 * fs.readFile/readFileSync (e o AdmZip depende disso), então tudo é feito em fluxo.
 */

export interface ExtractProgress {
  percent: number
  extractedBytes: number
  totalBytes: number
  currentFile: string
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

/** Espaço livre (em bytes) do disco onde `dir` está (ou estaria). null se o sistema não informar. */
export async function getFreeBytes(dir: string): Promise<number | null> {
  let probe = path.resolve(dir)
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe)
    if (parent === probe) break
    probe = parent
  }
  try {
    const stats = await fs.promises.statfs(probe)
    return Number(stats.bavail) * Number(stats.bsize)
  } catch {
    return null
  }
}

/** Falha cedo, com uma mensagem clara, em vez de encher o disco no meio da extração. */
export async function ensureFreeSpace(dir: string, neededBytes: number, what: string): Promise<void> {
  const free = await getFreeBytes(dir)
  if (free !== null && free < neededBytes) {
    throw new Error(
      `Espaço insuficiente em disco para ${what}: são necessários ${formatBytes(neededBytes)} e há ${formatBytes(free)} livres em "${path.resolve(dir)}". Libere espaço ou mude a pasta do Cofre nas Configurações.`
    )
  }
}

function openZip(file: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    // decodeStrings:false -> recebemos o nome como bytes e tratamos nós mesmos: zips feitos pelo
    // PowerShell/Windows usam "\" como separador, que o yauzl recusaria como "inválido".
    yauzl.open(
      file,
      { lazyEntries: true, decodeStrings: false, autoClose: false },
      (err, zipfile) => (err || !zipfile ? reject(err ?? new Error('zip vazio')) : resolve(zipfile))
    )
  })
}

function decodeName(raw: Buffer | string, flags: number): string {
  if (typeof raw === 'string') return raw
  const utf8 = raw.toString('utf8')
  // Bit 11 = nome em UTF-8; sem ele, zips antigos usam CP437/Latin-1
  return (flags & 0x800) !== 0 || !utf8.includes('\uFFFD') ? utf8 : raw.toString('latin1')
}

interface ZipItem {
  entry: yauzl.Entry
  name: string
  isDirectory: boolean
}

function readAllEntries(zip: yauzl.ZipFile): Promise<ZipItem[]> {
  return new Promise((resolve, reject) => {
    const items: ZipItem[] = []
    zip.on('error', reject)
    zip.on('end', () => resolve(items))
    zip.on('entry', (entry: yauzl.Entry) => {
      const name = decodeName(entry.fileName as unknown as Buffer, entry.generalPurposeBitFlag)
      items.push({ entry, name, isDirectory: /[\\/]$/.test(name) })
      zip.readEntry()
    })
    zip.readEntry()
  })
}

function openEntryStream(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) =>
    zip.openReadStream(entry, (err, stream) =>
      err || !stream ? reject(err ?? new Error('não foi possível ler a entrada')) : resolve(stream)
    )
  )
}

/**
 * Extrai um .zip (inclusive zip64, acima de 4 GB) entrada por entrada, sem carregar o arquivo
 * na memória nem travar a interface, e preserva o bit de execução em sistemas Unix.
 */
export async function extractZipStreaming(
  archivePath: string,
  destDir: string,
  options: { onProgress?: (progress: ExtractProgress) => void; spaceMarginBytes?: number } = {}
): Promise<{ fileCount: number; totalBytes: number }> {
  const zip = await openZip(archivePath)
  try {
    const items = await readAllEntries(zip)
    const totalBytes = items
      .filter((i) => !i.isDirectory)
      .reduce((sum, i) => sum + i.entry.uncompressedSize, 0)

    await fs.promises.mkdir(destDir, { recursive: true })
    await ensureFreeSpace(
      destDir,
      totalBytes + (options.spaceMarginBytes ?? 512 * 1024 * 1024),
      `extrair "${path.basename(archivePath)}"`
    )

    const root = path.resolve(destDir)
    let extractedBytes = 0
    let lastEmit = 0
    const emit = (currentFile: string, force = false): void => {
      if (!options.onProgress) return
      const now = Date.now()
      if (!force && now - lastEmit < 150) return
      lastEmit = now
      options.onProgress({
        percent: totalBytes > 0 ? Math.min(100, Math.round((extractedBytes / totalBytes) * 100)) : 100,
        extractedBytes,
        totalBytes,
        currentFile
      })
    }

    let fileCount = 0
    for (const item of items) {
      const relative = item.name.replace(/\\/g, '/').replace(/^\/+/, '')
      const outPath = path.resolve(root, relative)
      // Proteção contra "zip slip": nada pode ser gravado fora da pasta de destino
      if (outPath !== root && !outPath.startsWith(root + path.sep)) continue

      if (item.isDirectory) {
        await fs.promises.mkdir(outPath, { recursive: true })
        continue
      }

      const unixMode = item.entry.externalFileAttributes >>> 16
      // Atalhos simbólicos dentro do zip são ignorados (poderiam apontar para fora da pasta)
      if ((unixMode & 0o170000) === 0o120000) continue

      await fs.promises.mkdir(path.dirname(outPath), { recursive: true })
      const readStream = await openEntryStream(zip, item.entry)
      readStream.on('data', (chunk: Buffer) => {
        extractedBytes += chunk.length
        emit(relative)
      })
      await pipeline(readStream, fs.createWriteStream(outPath))
      fileCount++

      if (process.platform !== 'win32' && (unixMode & 0o111) !== 0) {
        try {
          await fs.promises.chmod(outPath, (unixMode & 0o777) | 0o600)
        } catch {
          // Pendrives FAT/NTFS não aceitam chmod
        }
      }
    }

    emit('', true)
    return { fileCount, totalBytes }
  } finally {
    zip.close()
  }
}

/** Soma o tamanho dos arquivos de uma pasta sem seguir atalhos simbólicos. */
export async function directorySize(
  dir: string,
  onProgress?: (files: number, bytes: number) => void
): Promise<{ bytes: number; files: number }> {
  let bytes = 0
  let files = 0
  const stack = [dir]
  let lastEmit = 0
  while (stack.length > 0) {
    const current = stack.pop()!
    let handle: fs.Dir
    try {
      handle = await fs.promises.opendir(current)
    } catch {
      continue
    }
    for await (const entry of handle) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
      } else if (entry.isFile()) {
        try {
          bytes += (await fs.promises.stat(full)).size
          files++
        } catch {
          // arquivo sumiu no meio do caminho
        }
        if (onProgress && Date.now() - lastEmit > 200) {
          lastEmit = Date.now()
          onProgress(files, bytes)
        }
      }
    }
  }
  return { bytes, files }
}

/**
 * Depois de extrair um dump, a raiz do jogo costuma estar dentro de uma única pasta
 * (ex.: "CUSA03173/eboot.bin"). Desce enquanto houver só uma subpasta e nenhum arquivo.
 */
export function resolveExtractionRoot(dir: string): string {
  let current = dir
  for (let depth = 0; depth < 3; depth++) {
    let entries: fs.Dirent[]
    try {
      entries = fs
        .readdirSync(current, { withFileTypes: true })
        .filter((e) => !e.name.startsWith('.') && e.name !== '__MACOSX')
    } catch {
      return current
    }
    if (entries.length === 1 && entries[0].isDirectory()) {
      current = path.join(current, entries[0].name)
    } else {
      break
    }
  }
  return current
}

/**
 * Acha a pasta que contém `marker` (ex.: eboot.bin) olhando a própria pasta e as subpastas até
 * `maxDepth` níveis. Serve para quem escolhe a pasta "de cima" do dump (ex.: Dumps/CUSA03173/...).
 */
export function findMarkerRoot(dir: string, marker: string, maxDepth = 2): string | null {
  const wanted = marker.toLowerCase()
  let level = [dir]
  for (let depth = 0; depth <= maxDepth; depth++) {
    const next: string[] = []
    for (const current of level) {
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(current, { withFileTypes: true })
      } catch {
        continue
      }
      if (entries.some((e) => e.isFile() && e.name.toLowerCase() === wanted)) return current
      for (const e of entries) {
        if (e.isDirectory() && !e.name.startsWith('.')) next.push(path.join(current, e.name))
      }
    }
    level = next
  }
  return null
}

/** Lista os nomes dentro de um .zip lendo só o índice (não extrai nada). */
export async function listZipNames(archivePath: string): Promise<string[]> {
  const zip = await openZip(archivePath)
  try {
    const items = await readAllEntries(zip)
    return items.map((i) => i.name.replace(/\\/g, '/'))
  } finally {
    zip.close()
  }
}

/** Procura arquivos com certa extensão até `maxDepth` níveis (para avisar "isto é um .pkg"). */
export function findFilesByExtension(dir: string, extension: string, maxDepth = 3, limit = 5): string[] {
  const found: string[] = []
  const walk = (current: string, depth: number): void => {
    if (depth > maxDepth || found.length >= limit) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (found.length >= limit) return
      const full = path.join(current, e.name)
      if (e.isFile() && e.name.toLowerCase().endsWith(extension)) found.push(full)
      else if (e.isDirectory() && !e.name.startsWith('.')) walk(full, depth + 1)
    }
  }
  walk(dir, 0)
  return found
}
