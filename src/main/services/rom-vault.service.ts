import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { spawn } from 'child_process'
import AdmZip from 'adm-zip'
import * as tar from 'tar'
import {
  CatalogGame,
  RomAvailabilityStatus,
  RomRequirement,
  RomVaultEntry
} from '../../shared/types'
import { StoreService } from './store.service'

const SUPPORTED_ROM_EXTENSIONS = new Set([
  '.z64',
  '.n64',
  '.v64',
  '.iso',
  '.bin',
  '.cue',
  '.img',
  '.rom',
  '.chd',
  '.xex',
  '.xbe',
  '.gcm',
  '.rvz',
  '.wbfs',
  '.wux',
  '.wud',
  '.rpx',
  '.cso',
  '.pkg',
  '.nds',
  '.3ds',
  '.cia',
  '.cci',
  '.gba',
  '.gbc',
  '.gb',
  '.sfc',
  '.smc',
  '.nes',
  '.md',
  '.gen',
  '.smd',
  '.vb',
  '.cdi',
  '.gdi',
  '.dat',
  '.pak',
  '.wad',
  '.rsdk',
  '.nkit'
])

const COMPRESSED_ARCHIVE_EXTENSIONS = new Set([
  '.zip',
  '.7z',
  '.rar',
  '.gz',
  '.tgz',
  '.xz'
])

function isPathInsideDirectory(directory: string, filePath: string): boolean {
  const relativePath = path.relative(path.resolve(directory), path.resolve(filePath))
  return (
    relativePath === '' ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  )
}

export class RomVaultService {
  constructor(private store: StoreService) {}

  public getVaultEntries(): RomVaultEntry[] {
    return this.store.getRomVault().filter((e) => fs.existsSync(e.filePath))
  }

  /**
   * Scans the configured ROM Vault directory recursively and computes SHA-1 and MD5 hashes
   */
  public async scanDirectory(
    customDir?: string,
    onProgress?: (data: { current: number; total: number; currentFile: string }) => void
  ): Promise<{ entries: RomVaultEntry[]; scannedCount: number }> {
    const settings = this.store.getSettings()
    const targetDir = customDir || settings.romVaultPath

    if (!targetDir || !fs.existsSync(targetDir)) {
      return { entries: this.getVaultEntries(), scannedCount: 0 }
    }

    if (customDir && customDir !== settings.romVaultPath) {
      this.store.updateSettings({ romVaultPath: customDir })
    }

    const existingByPath = new Map<string, RomVaultEntry>()
    for (const entry of this.store.getRomVault()) {
      existingByPath.set(entry.filePath, entry)
    }

    const candidateFiles = this.collectRomFiles(targetDir)
    const results: RomVaultEntry[] = []

    for (const existing of this.store.getRomVault()) {
      if (
        !isPathInsideDirectory(targetDir, existing.filePath) &&
        fs.existsSync(existing.filePath)
      ) {
        results.push(existing)
      }
    }

    for (let i = 0; i < candidateFiles.length; i++) {
      const filePath = candidateFiles[i]
      const fileName = path.basename(filePath)

      if (onProgress) {
        onProgress({
          current: i + 1,
          total: candidateFiles.length,
          currentFile: fileName
        })
      }

      try {
        const stat = fs.statSync(filePath)
        const cached = existingByPath.get(filePath)
        if (
          cached &&
          cached.size === stat.size &&
          cached.fileModifiedAt === stat.mtimeMs &&
          cached.sha1 &&
          cached.md5
        ) {
          results.push(cached)
          continue
        }

        const { sha1, md5 } = await this.computeFileHashes(filePath)
        results.push({
          filePath,
          fileName,
          size: stat.size,
          fileModifiedAt: stat.mtimeMs,
          sha1: sha1.toLowerCase(),
          md5: md5.toLowerCase(),
          extension: path.extname(filePath).toLowerCase(),
          scannedAt: new Date().toISOString(),
          assignedGameIds: cached?.assignedGameIds,
          assignedRequirementIds: cached?.assignedRequirementIds,
          extractedFromArchive: cached?.extractedFromArchive
        })
      } catch (err) {
        console.warn(`[RomVaultService] Skipping file ${filePath}:`, err)
      }
    }

    this.store.setRomVault(results)
    return { entries: results, scannedCount: candidateFiles.length }
  }

  /**
   * Imports a user-selected file for a specific game requirement with live progress reporting.
   * Accepts either:
   *  - A direct ROM/ISO file (.iso, .z64, .n64, .bin, .cue, .xex, etc.)
   *  - A compressed archive (.zip, .7z, .rar, .tar.gz, .tgz) containing the ROM/ISO inside!
   */
  public async importRomOrArchiveForGame(
    pickedFilePath: string,
    game: CatalogGame,
    requirementId?: string,
    onProgress?: (percent: number, stageLabel: string) => void
  ): Promise<RomVaultEntry> {
    if (!fs.existsSync(pickedFilePath)) {
      throw new Error(`Arquivo não encontrado: ${pickedFilePath}`)
    }

    const req =
      game.recipe?.requirements.find((r) => r.id === requirementId) ||
      game.recipe?.requirements[0]

    const lowerName = pickedFilePath.toLowerCase()
    const ext = path.extname(lowerName)
    const isCompressed =
      COMPRESSED_ARCHIVE_EXTENSIONS.has(ext) ||
      lowerName.endsWith('.tar.gz') ||
      lowerName.endsWith('.tar.xz')

    let finalRomPath = pickedFilePath
    let extractedFromArchive: string | undefined

    if (isCompressed) {
      extractedFromArchive = path.basename(pickedFilePath)
      if (onProgress) {
        onProgress(2, `Extraindo ISO/ROM de ${extractedFromArchive}...`)
      }
      finalRomPath = await this.extractRomFromCompressedFile(
        pickedFilePath,
        game,
        req,
        (pct) => {
          if (onProgress) {
            onProgress(
              Math.min(95, Math.max(2, pct)),
              `Extraindo ${extractedFromArchive} (${pct}%)...`
            )
          }
        }
      )
    } else {
      const vaultDir = path.join(
        this.store.getSettings().romVaultPath,
        game.id.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 60)
      )
      finalRomPath = this.normalizeN64Rom(pickedFilePath, vaultDir)
    }

    if (onProgress) {
      onProgress(96, `Verificando arquivo ${path.basename(finalRomPath)}...`)
    }

    const stat = fs.statSync(finalRomPath)
    const needsFullHash = Boolean(req?.sha1 && req.sha1.length > 0)
    const { sha1, md5 } = await this.computeFileHashes(
      finalRomPath,
      !needsFullHash && stat.size > 200 * 1024 * 1024
    )

    const entry: RomVaultEntry = {
      filePath: finalRomPath,
      fileName: path.basename(finalRomPath),
      size: stat.size,
      fileModifiedAt: stat.mtimeMs,
      sha1: sha1.toLowerCase(),
      md5: md5.toLowerCase(),
      extension: path.extname(finalRomPath).toLowerCase(),
      scannedAt: new Date().toISOString(),
      assignedGameIds: [game.id],
      assignedRequirementIds: req ? [`${game.id}::${req.id}`] : [],
      extractedFromArchive
    }

    this.store.upsertRomVaultEntry(entry)
    if (onProgress) {
      onProgress(100, `ISO/ROM pronta: ${entry.fileName}`)
    }
    return entry
  }

  private async extractRomFromCompressedFile(
    archivePath: string,
    game: CatalogGame,
    req?: RomRequirement,
    onPercent?: (pct: number) => void
  ): Promise<string> {
    const settings = this.store.getSettings()
    const gameVaultSubdir = path.join(
      settings.romVaultPath,
      game.id.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 60)
    )

    if (!fs.existsSync(gameVaultSubdir)) {
      fs.mkdirSync(gameVaultSubdir, { recursive: true })
    }

    const lower = archivePath.toLowerCase()

    if (lower.endsWith('.zip')) {
      if (onPercent) onPercent(20)
      const zip = new AdmZip(archivePath)
      zip.extractAllTo(gameVaultSubdir, true)
      if (onPercent) onPercent(95)
    } else if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
      if (onPercent) onPercent(20)
      await tar.x({
        file: archivePath,
        cwd: gameVaultSubdir
      })
      if (onPercent) onPercent(95)
    } else if (
      lower.endsWith('.7z') ||
      lower.endsWith('.rar') ||
      lower.endsWith('.tar.xz')
    ) {
      await this.extractWithSystemTool(archivePath, gameVaultSubdir, onPercent)
    } else {
      throw new Error(`Formato compactado não suportado: ${path.basename(archivePath)}`)
    }

    const extractedFiles = this.collectAllFilesRecursive(gameVaultSubdir)
    if (extractedFiles.length === 0) {
      throw new Error(
        `O arquivo compactado "${path.basename(archivePath)}" está vazio ou não pôde ser extraído.`
      )
    }

    const preferredExts = new Set(
      (req?.extensions || []).map((e) => e.toLowerCase())
    )

    const matchingByReqExt = extractedFiles.filter((filePath) =>
      preferredExts.has(path.extname(filePath).toLowerCase())
    )
    const matchingSupported = extractedFiles.filter((filePath) =>
      SUPPORTED_ROM_EXTENSIONS.has(path.extname(filePath).toLowerCase())
    )
    const chosenFile =
      matchingByReqExt[0] || matchingSupported[0] || extractedFiles[0]

    return this.normalizeN64Rom(chosenFile, gameVaultSubdir)
  }

  /**
   * Checks if an N64 ROM file is byte-swapped (.v64, 0x37804012) or little-endian (.n64, 0x40123780)
   * and creates a canonical Big-Endian copy without modifying the user's source file.
   */
  private normalizeN64Rom(filePath: string, destinationDir: string): string {
    try {
      if (!fs.existsSync(filePath)) return filePath
      const stat = fs.statSync(filePath)
      if (stat.size < 4 || stat.size > 64 * 1024 * 1024) return filePath

      const fd = fs.openSync(filePath, 'r')
      const magicBuf = Buffer.alloc(4)
      fs.readSync(fd, magicBuf, 0, 4, 0)
      fs.closeSync(fd)

      const magic = magicBuf.readUInt32BE(0)
      if (magic === 0x80371240) {
        // Already canonical big-endian .z64
        return filePath
      }

      if (magic === 0x37804012 || magic === 0x40123780) {
        const data = fs.readFileSync(filePath)
        const swapped = Buffer.alloc(data.length)

        if (magic === 0x37804012) {
          // BADC -> ABCD (v64 byte-swap)
          for (let i = 0; i < data.length; i += 2) {
            swapped[i] = data[i + 1]
            swapped[i + 1] = data[i]
          }
        } else {
          // DCBA -> ABCD (n64 word-swap)
          for (let i = 0; i < data.length; i += 4) {
            swapped[i] = data[i + 3]
            swapped[i + 1] = data[i + 2]
            swapped[i + 2] = data[i + 1]
            swapped[i + 3] = data[i]
          }
        }

        const baseWithoutExt = path.basename(filePath, path.extname(filePath))
        const newZ64Path = path.join(
          destinationDir,
          `${baseWithoutExt}.normalized.z64`
        )

        fs.mkdirSync(destinationDir, { recursive: true })
        fs.writeFileSync(newZ64Path, swapped)
        return newZ64Path
      }
    } catch {
      // Return original on error
    }
    return filePath
  }

  private extractWithSystemTool(
    archivePath: string,
    destDir: string,
    onPercent?: (pct: number) => void
  ): Promise<void> {
    const lower = archivePath.toLowerCase()
    const commandsToTry: { cmd: string; args: string[] }[] = []

    if (lower.endsWith('.rar')) {
      commandsToTry.push(
        { cmd: 'unrar', args: ['x', '-y', archivePath, `${destDir}/`] },
        { cmd: '7z', args: ['x', '-bsp1', '-y', archivePath, `-o${destDir}`] },
        { cmd: 'unar', args: ['-f', '-o', destDir, archivePath] },
        { cmd: 'bsdtar', args: ['-xf', archivePath, '-C', destDir] }
      )
    } else if (lower.endsWith('.7z')) {
      commandsToTry.push(
        { cmd: '7z', args: ['x', '-bsp1', '-y', archivePath, `-o${destDir}`] },
        { cmd: '7za', args: ['x', '-bsp1', '-y', archivePath, `-o${destDir}`] },
        { cmd: 'unar', args: ['-f', '-o', destDir, archivePath] },
        { cmd: 'bsdtar', args: ['-xf', archivePath, '-C', destDir] }
      )
    } else {
      commandsToTry.push({ cmd: 'tar', args: ['-xf', archivePath, '-C', destDir] })
    }

    return new Promise((resolve, reject) => {
      const tryNext = (index: number): void => {
        if (index >= commandsToTry.length) {
          reject(
            new Error(
              `Não foi possível extrair "${path.basename(archivePath)}". Para arquivos .7z ou .rar, certifique-se de ter o 7z/unrar instalado.`
            )
          )
          return
        }

        const { cmd, args } = commandsToTry[index]
        const proc = spawn(cmd, args)

        const parseOutput = (chunk: Buffer): void => {
          if (!onPercent) return
          const text = chunk.toString()
          const matches = text.match(/(\d{1,3})%/g)
          if (matches && matches.length > 0) {
            const last = matches[matches.length - 1]
            const val = parseInt(last.replace('%', ''), 10)
            if (!isNaN(val) && val >= 0 && val <= 100) {
              onPercent(val)
            }
          }
        }

        proc.stdout.on('data', parseOutput)
        proc.stderr.on('data', parseOutput)

        proc.on('error', () => tryNext(index + 1))
        proc.on('close', (code) => {
          if (code === 0) resolve()
          else tryNext(index + 1)
        })
      }

      tryNext(0)
    })
  }

  private collectAllFilesRecursive(dir: string, maxDepth = 4, depth = 0): string[] {
    if (depth > maxDepth || !fs.existsSync(dir)) return []
    const files: string[] = []
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (d.name.startsWith('.')) continue
      const fullPath = path.join(dir, d.name)
      if (d.isDirectory()) {
        files.push(...this.collectAllFilesRecursive(fullPath, maxDepth, depth + 1))
      } else if (d.isFile()) {
        files.push(fullPath)
      }
    }
    return files
  }

  private collectRomFiles(dir: string, maxDepth = 4, currentDepth = 0): string[] {
    if (currentDepth > maxDepth) return []
    const files: string[] = []
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return files
    }

    for (const d of entries) {
      if (d.name.startsWith('.')) continue
      const fullPath = path.join(dir, d.name)
      if (d.isDirectory()) {
        files.push(...this.collectRomFiles(fullPath, maxDepth, currentDepth + 1))
      } else if (d.isFile()) {
        const ext = path.extname(d.name).toLowerCase()
        if (SUPPORTED_ROM_EXTENSIONS.has(ext)) {
          files.push(fullPath)
        }
      }
    }
    return files
  }

  public async computeFileHashes(
    filePath: string,
    fastModeForLargeIso = false
  ): Promise<{ sha1: string; md5: string }> {
    try {
      const stat = fs.statSync(filePath)
      // Check for N64 ROMs (<= 64MB) in non-canonical byte order to report canonical big-endian hashes
      if (stat.size >= 4 && stat.size <= 64 * 1024 * 1024) {
        const fd = fs.openSync(filePath, 'r')
        const magicBuf = Buffer.alloc(4)
        fs.readSync(fd, magicBuf, 0, 4, 0)
        fs.closeSync(fd)
        const magic = magicBuf.readUInt32BE(0)

        if (magic === 0x37804012 || magic === 0x40123780) {
          const data = fs.readFileSync(filePath)
          const swapped = Buffer.alloc(data.length)
          if (magic === 0x37804012) {
            for (let i = 0; i < data.length; i += 2) {
              swapped[i] = data[i + 1]
              swapped[i + 1] = data[i]
            }
          } else {
            for (let i = 0; i < data.length; i += 4) {
              swapped[i] = data[i + 3]
              swapped[i + 1] = data[i + 2]
              swapped[i + 2] = data[i + 1]
              swapped[i + 3] = data[i]
            }
          }
          return {
            sha1: crypto.createHash('sha1').update(swapped).digest('hex').toLowerCase(),
            md5: crypto.createHash('md5').update(swapped).digest('hex').toLowerCase()
          }
        }
      }
    } catch {
      // Continue to standard calculation
    }

    if (fastModeForLargeIso) {
      try {
        const stat = fs.statSync(filePath)
        const fd = fs.openSync(filePath, 'r')
        const sampleSize = Math.min(8 * 1024 * 1024, stat.size)
        const buf = Buffer.alloc(sampleSize)
        fs.readSync(fd, buf, 0, sampleSize, 0)
        fs.closeSync(fd)

        const sha1 = crypto
          .createHash('sha1')
          .update(buf)
          .update(String(stat.size))
          .digest('hex')
          .toLowerCase()
        const md5 = crypto
          .createHash('md5')
          .update(buf)
          .update(String(stat.size))
          .digest('hex')
          .toLowerCase()
        return Promise.resolve({ sha1, md5 })
      } catch {
        // Fallback to stream
      }
    }

    return new Promise((resolve, reject) => {
      const sha1Hash = crypto.createHash('sha1')
      const md5Hash = crypto.createHash('md5')
      const stream = fs.createReadStream(filePath)

      stream.on('data', (chunk) => {
        sha1Hash.update(chunk)
        md5Hash.update(chunk)
      })
      stream.on('end', () => {
        resolve({
          sha1: sha1Hash.digest('hex').toLowerCase(),
          md5: md5Hash.digest('hex').toLowerCase()
        })
      })
      stream.on('error', (err) => reject(err))
    })
  }

  public async checkRomAvailability(game: CatalogGame): Promise<RomAvailabilityStatus> {
    const recipe = game.recipe
    const requirements: RomRequirement[] =
      recipe && recipe.requirements.length > 0
        ? recipe.requirements
        : [
            {
              id: `${game.id}_rom`,
              label: `${game.title} — ISO / ROM Original`,
              type: 'iso',
              expectedFilename: 'game.iso',
              extensions: ['.iso', '.bin', '.z64', '.n64', '.rom']
            }
          ]

    const localEntries = this.getVaultEntries()

    const matchedRequirements = requirements.map((req) => {
      const localMatch = this.findLocalMatch(req, game, localEntries)
      if (localMatch) {
        return {
          requirement: req,
          status: 'local_vault' as const,
          localEntry: localMatch
        }
      }

      return {
        requirement: req,
        status: 'missing' as const
      }
    })

    const allSatisfied = matchedRequirements.every(
      (m) => m.status === 'local_vault' || m.requirement.optional
    )

    return {
      ready: allSatisfied,
      source: allSatisfied ? 'local_vault' : 'missing',
      matchedRequirements
    }
  }

  private findLocalMatch(
    req: RomRequirement,
    game: CatalogGame,
    localEntries: RomVaultEntry[]
  ): RomVaultEntry | undefined {
    const reqKey = `${game.id}::${req.id}`
    const byExplicitReq = localEntries.find(
      (e) =>
        e.assignedRequirementIds?.includes(reqKey) && fs.existsSync(e.filePath)
    )
    if (byExplicitReq) return byExplicitReq

    if (req.type !== 'bios') {
      const byExplicitGame = localEntries.find(
        (e) =>
          e.assignedGameIds?.includes(game.id) &&
          !e.fileName.toLowerCase().includes('scph') &&
          fs.existsSync(e.filePath)
      )
      if (byExplicitGame) return byExplicitGame
    }

    if (req.sha1 && req.sha1.length > 0) {
      const targetHashes = new Set(req.sha1.map((h) => h.toLowerCase()))
      const bySha1 = localEntries.find(
        (e) => targetHashes.has(e.sha1.toLowerCase()) && fs.existsSync(e.filePath)
      )
      if (bySha1) return bySha1
    }

    if (req.md5 && req.md5.length > 0) {
      const targetMd5 = new Set(req.md5.map((h) => h.toLowerCase()))
      const byMd5 = localEntries.find(
        (e) => targetMd5.has(e.md5.toLowerCase()) && fs.existsSync(e.filePath)
      )
      if (byMd5) return byMd5
    }

    if (req.type === 'bios') {
      const byBiosName = localEntries.find(
        (e) =>
          e.fileName.toLowerCase().includes('scph') &&
          e.extension === '.bin' &&
          fs.existsSync(e.filePath)
      )
      if (byBiosName) return byBiosName
    }

    const allowedExts = new Set(req.extensions.map((ext) => ext.toLowerCase()))
    const titleKeywords = game.title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !['the', 'and', 'for'].includes(w))

    if (titleKeywords.length > 0) {
      const byKeywords = localEntries.find((e) => {
        if (!allowedExts.has(e.extension) || !fs.existsSync(e.filePath)) return false
        const fn = e.fileName.toLowerCase()
        const matchCount = titleKeywords.filter((kw) => fn.includes(kw)).length
        return matchCount >= Math.min(2, titleKeywords.length)
      })
      if (byKeywords) return byKeywords
    }

    return undefined
  }
}
