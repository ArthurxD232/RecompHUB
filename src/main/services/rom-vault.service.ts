import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { spawn } from 'child_process'
import * as tar from 'tar'
import {
  CatalogGame,
  RomAvailabilityStatus,
  RomRequirement,
  RomVaultEntry
} from '../../shared/types'
import { StoreService } from './store.service'
import {
  genericIsoRequirement,
  withPatchRequirement
} from '../../shared/requirements'
import {
  extractPkgSet,
  extractPkgSetExternal,
  findExternalPkgExtractor,
  findPkgKeysFile,
  loadPkgKeysFile,
  probePkgExtractor
} from './pkg'
import {
  directorySize,
  extractZipStreaming,
  findFilesByExtension,
  findMarkerRoot,
  formatBytes,
  listZipNames,
  resolveExtractionRoot
} from './archive.service'

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

    // Dumps extraídos (centenas de milhares de arquivos .pak/.bin/.dat) não devem ser varridos nem
    // calculados um a um: a pasta inteira já é um item do cofre.
    const skipDirs = new Set(
      this.store
        .getRomVault()
        .filter((e) => e.isDirectory)
        .map((e) => path.resolve(e.filePath))
    )
    const candidateFiles = this.collectRomFiles(targetDir, 4, 0, skipDirs)
    const results: RomVaultEntry[] = []

    for (const existing of this.store.getRomVault()) {
      const keep =
        !isPathInsideDirectory(targetDir, existing.filePath) ||
        existing.isDirectory ||
        existing.kind === 'patch'
      if (keep && fs.existsSync(existing.filePath)) {
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

  private getRequirements(game: CatalogGame): RomRequirement[] {
    const recipe = game.recipe
    const base: RomRequirement[] =
      recipe
        ? recipe.requirements.length > 0
          ? recipe.requirements
          : [genericIsoRequirement(game.id, game.title, true)]
        : [genericIsoRequirement(game.id, game.title)]
    // Todo jogo ganha o espaço opcional de patches/atualizações/DLC
    return withPatchRequirement(base)
  }

  private gameVaultDir(game: CatalogGame): string {
    return path.join(
      this.store.getSettings().romVaultPath,
      game.id.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 60)
    )
  }

  private pseudoHashes(label: string): { sha1: string; md5: string } {
    return {
      sha1: crypto.createHash('sha1').update(label).digest('hex'),
      md5: crypto.createHash('md5').update(label).digest('hex')
    }
  }

  /**
   * Imports a user-selected item for a specific game requirement with live progress reporting.
   * Accepts either:
   *  - A direct ROM/ISO file (.iso, .z64, .n64, .bin, .cue, .xex, etc.)
   *  - A compressed archive (.zip, .7z, .rar, .tar.gz, .tgz) containing the ROM/ISO inside
   *  - A folder (dumps de PS4 etc.): fica registrada por referência, sem copiar dezenas de GB
   *  - Patches/atualizações/DLC (requisito do tipo "patch"): arquivos ou pastas, também por referência
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

    const requirements = this.getRequirements(game)
    const req =
      requirements.find((r) => r.id === requirementId) ||
      requirements.find((r) => r.type !== 'patch')

    const pickedStat = fs.statSync(pickedFilePath)

    if (req?.type === 'patch') {
      const lowerName = pickedFilePath.toLowerCase()
      const ext = path.extname(lowerName)
      const isCompressed =
        COMPRESSED_ARCHIVE_EXTENSIONS.has(ext) ||
        lowerName.endsWith('.tar.gz') ||
        lowerName.endsWith('.tar.xz')

      // 1. Arquivo .pkg direto
      if (this.isPkgFile(pickedFilePath)) {
        const dumpDir = this.findGameDumpDir(game)
        if (!dumpDir) {
          throw new Error(
            'O jogo base ainda não foi adicionado ao Cofre. Adicione primeiro o jogo base (no campo principal acima) antes de aplicar a atualização.'
          )
        }
        return this.applyPatchPkgs([pickedFilePath], dumpDir, game, req, path.basename(pickedFilePath), onProgress, {
          recordFilePath: pickedFilePath
        })
      }

      // 2. Pasta contendo arquivos .pkg
      if (pickedStat.isDirectory()) {
        const pkgs = findFilesByExtension(pickedFilePath, '.pkg', 3, 200).filter((f) => this.isPkgFile(f))
        if (pkgs.length > 0) {
          const dumpDir = this.findGameDumpDir(game)
          if (!dumpDir) {
            throw new Error(
              'O jogo base ainda não foi adicionado ao Cofre. Adicione primeiro o jogo base (no campo principal acima) antes de aplicar a atualização.'
            )
          }
          return this.applyPatchPkgs(pkgs, dumpDir, game, req, path.basename(pickedFilePath), onProgress, {
            recordFilePath: pickedFilePath
          })
        }
        return this.importPatch(pickedFilePath, pickedStat, game, req, onProgress)
      }

      // 3. Arquivo compactado (.zip, .7z, .rar, etc.)
      if (isCompressed) {
        let archiveHasPkg = false
        if (lowerName.endsWith('.zip')) {
          onProgress?.(1, `Conferindo o conteúdo de ${path.basename(pickedFilePath)}...`)
          try {
            const names = await listZipNames(pickedFilePath)
            archiveHasPkg = names.some((n) => n.toLowerCase().endsWith('.pkg'))
          } catch {
            archiveHasPkg = false
          }
        }

        const dumpDir = this.findGameDumpDir(game)
        if (archiveHasPkg || (dumpDir && (lowerName.endsWith('.7z') || lowerName.endsWith('.rar')))) {
          const archiveName = path.basename(pickedFilePath)
          const tempExtractDir = path.join(
            this.gameVaultDir(game),
            '.temp_patch_' + Date.now()
          )
          fs.rmSync(tempExtractDir, { recursive: true, force: true })
          onProgress?.(2, `Extraindo ${archiveName}...`)
          const archiveShare = 0.45
          await this.extractArchive(pickedFilePath, tempExtractDir, (pct) =>
            onProgress?.(
              Math.min(93, Math.max(2, Math.round(pct * archiveShare))),
              `Extraindo ${archiveName} (${pct}%)...`
            )
          )

          const pkgs = findFilesByExtension(tempExtractDir, '.pkg', 4, 200).filter((f) => this.isPkgFile(f))
          if (pkgs.length > 0) {
            if (!dumpDir) {
              fs.rmSync(tempExtractDir, { recursive: true, force: true })
              throw new Error(
                'O jogo base ainda não foi adicionado ao Cofre. Adicione primeiro o jogo base (no campo principal acima) antes de aplicar a atualização.'
              )
            }
            return this.applyPatchPkgs(pkgs, dumpDir, game, req, archiveName, onProgress, {
              removeAfter: tempExtractDir,
              progressFrom: 46,
              recordFilePath: pickedFilePath
            })
          }
          // Sem PKGs válidos dentro, limpa e prossegue para patch comum
          fs.rmSync(tempExtractDir, { recursive: true, force: true })
        }
      }

      return this.importPatch(pickedFilePath, pickedStat, game, req, onProgress)
    }

    if (pickedStat.isDirectory()) {
      // Pasta sem o jogo extraído, mas com arquivos .pkg: o RecompHUB extrai sozinho
      if (req?.type === 'folder' && req.markerFile && !findMarkerRoot(pickedFilePath, req.markerFile, 2)) {
        const pkgs = findFilesByExtension(pickedFilePath, '.pkg', 3, 200)
        if (pkgs.length > 0) {
          return this.importFromPkgs(pkgs, game, req, path.basename(pickedFilePath), onProgress)
        }
      }
      return this.importDirectory(this.resolveGameRoot(pickedFilePath, req), game, req, undefined, onProgress)
    }

    // Um único .pkg escolhido para um jogo que é pasta: extrai
    if (req?.type === 'folder' && pickedFilePath.toLowerCase().endsWith('.pkg')) {
      return this.importFromPkgs([pickedFilePath], game, req, path.basename(pickedFilePath), onProgress)
    }

    const lowerName = pickedFilePath.toLowerCase()
    const ext = path.extname(lowerName)
    const isCompressed =
      COMPRESSED_ARCHIVE_EXTENSIONS.has(ext) ||
      lowerName.endsWith('.tar.gz') ||
      lowerName.endsWith('.tar.xz')

    // Jogo que é uma pasta, entregue num arquivo compactado: a pasta extraída é o item do cofre
    if (isCompressed && req?.type === 'folder') {
      const archiveName = path.basename(pickedFilePath)
      const extractDir = path.join(
        this.gameVaultDir(game),
        path.basename(archiveName).replace(/\.(tar\.gz|tar\.xz|tgz|zip|7z|rar|gz|xz)$/i, '')
      )
      // Antes de extrair dezenas de GB: o arquivo compactado tem mesmo o jogo? (só zip dá para listar rápido)
      let archiveHasPkg = false
      if (req.markerFile && pickedFilePath.toLowerCase().endsWith('.zip')) {
        onProgress?.(1, `Conferindo o conteúdo de ${archiveName}...`)
        const names = await listZipNames(pickedFilePath)
        const wanted = req.markerFile.toLowerCase()
        if (!names.some((n) => n.split('/').pop()?.toLowerCase() === wanted)) {
          archiveHasPkg = names.some((n) => n.toLowerCase().endsWith('.pkg'))
          if (!archiveHasPkg) throw new Error(this.missingMarkerMessage(req, false))
          // Sem extrator nem chaves os .pkg não servem: avisa agora, antes de extrair dezenas de GB
          await this.resolvePkgEngine()
        }
      }
      // Uma tentativa anterior pode ter ficado pela metade
      fs.rmSync(extractDir, { recursive: true, force: true })
      onProgress?.(2, `Extraindo ${archiveName}...`)
      // Com .pkg lá dentro, a extração do zip é só a primeira metade do trabalho
      const archiveShare = archiveHasPkg ? 0.45 : 0.93
      await this.extractArchive(pickedFilePath, extractDir, (pct) =>
        onProgress?.(
          Math.min(93, Math.max(2, Math.round(pct * archiveShare))),
          `Extraindo ${archiveName} (${pct}%)...`
        )
      )

      const extractedRoot = resolveExtractionRoot(extractDir)
      if (req.markerFile && !findMarkerRoot(extractedRoot, req.markerFile, 2)) {
        const pkgs = findFilesByExtension(extractDir, '.pkg', 4, 200)
        if (pkgs.length > 0) {
          // Os .pkg saíram do arquivo compactado: extrai o jogo deles e apaga a cópia temporária
          return this.importFromPkgs(pkgs, game, req, archiveName, onProgress, {
            removeAfter: extractDir,
            progressFrom: archiveHasPkg ? 46 : 50
          })
        }
        fs.rmSync(extractDir, { recursive: true, force: true })
        throw new Error(this.missingMarkerMessage(req, false))
      }
      return this.importDirectory(this.resolveGameRoot(extractedRoot, req), game, req, archiveName, onProgress)
    }

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
      finalRomPath = this.normalizeN64Rom(pickedFilePath, this.gameVaultDir(game))
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
      extractedFromArchive,
      kind: 'main'
    }

    this.store.upsertRomVaultEntry(entry)
    if (onProgress) {
      onProgress(100, `ISO/ROM pronta: ${entry.fileName}`)
    }
    return entry
  }

  private missingMarkerMessage(req: RomRequirement, foundPkg: boolean): string {
    const marker = req.markerFile || 'o arquivo principal'
    return foundPkg
      ? `Esses arquivos são pacotes .pkg do PlayStation, não o jogo extraído: não há "${marker}". O port precisa da pasta já desempacotada. Escolha a pasta onde estão os .pkg (o RecompHUB extrai sozinho se o PKG Extractor ou o arquivo de chaves estiver configurado em Configurações) ou extraia por conta própria (por exemplo com o ShadPs4Plus PKG Extractor) e escolha a pasta resultante, a que contém o ${marker}.`
      : `Essa pasta não parece ser o jogo extraído: não encontrei "${marker}" nela nem nas subpastas (até 2 níveis). Escolha a pasta que contém o ${marker}.`
  }

  /**
   * Escolhe como extrair PKGs: o PKG Extractor que o usuário já tem instalado (preferido) ou o motor
   * próprio com o arquivo de chaves dele. O RecompHUB não inclui nem baixa nenhum dos dois.
   */
  private async resolvePkgEngine(): Promise<
    { kind: 'external'; file: string } | { kind: 'builtin'; keysFile: string }
  > {
    const settings = this.store.getSettings()
    let extractorProblem = ''
    const external = findExternalPkgExtractor(settings.pkgExtractorPath)
    if (external) {
      const probe = await probePkgExtractor(external.path)
      if (probe.ok) return { kind: 'external', file: external.path }
      extractorProblem = ` O PKG Extractor encontrado em "${external.path}" não funcionou: ${probe.error}`
    }
    const keysFile = findPkgKeysFile(settings.pkgKeysPath)
    if (keysFile) return { kind: 'builtin', keysFile }
    throw new Error(
      `Esses arquivos são pacotes .pkg e precisam ser extraídos. O RecompHUB faz isso de duas formas, em Configurações > Extrair PKG do PS4: usando o PKG Extractor (ShadPs4Plus) que você já tem instalado, ou com o seu arquivo de chaves (keys.json). O app não inclui nenhum dos dois.${extractorProblem} Se preferir, extraia por conta própria e escolha a pasta já extraída, a que contém o eboot.bin.`
    )
  }

  /**
   * Extrai um ou mais .pkg do PS4 (jogo base + patches) para o Cofre e registra a pasta resultante.
   * Usa o PKG Extractor do usuário ou, sem ele, o motor próprio com o arquivo de chaves dele.
   */
  private async importFromPkgs(
    pkgFiles: string[],
    game: CatalogGame,
    req: RomRequirement,
    sourceLabel: string,
    onProgress?: (percent: number, stageLabel: string) => void,
    options: { removeAfter?: string; progressFrom?: number } = {}
  ): Promise<RomVaultEntry> {
    let engine: Awaited<ReturnType<RomVaultService['resolvePkgEngine']>>
    try {
      engine = await this.resolvePkgEngine()
    } catch (err) {
      if (options.removeAfter) fs.rmSync(options.removeAfter, { recursive: true, force: true })
      throw err
    }

    const gameDir = this.gameVaultDir(game)
    const destDir = path.join(gameDir, 'pkg-extraido')
    const addonsDir = path.join(gameDir, 'dlc-pkg')
    fs.rmSync(destDir, { recursive: true, force: true })
    fs.rmSync(addonsDir, { recursive: true, force: true })

    const from = options.progressFrom ?? 3
    const to = 94
    onProgress?.(from, `Lendo ${pkgFiles.length} arquivo(s) .pkg...`)
    let gameRoot: string
    let addons: { dir: string }[] = []
    let skippedCount = 0
    try {
      const toOverall = (percent: number): number => Math.round(from + (percent / 100) * (to - from))
      const result =
        engine.kind === 'external'
          ? await extractPkgSetExternal(pkgFiles, destDir, engine.file, {
              addonsDir,
              onProgress: (p) =>
                onProgress?.(
                  toOverall(p.percent),
                  `Extraindo ${p.pkgName} com o PKG Extractor (${p.percent}%)${p.detail ? ` — ${p.detail}` : ''}`
                )
            })
          : await extractPkgSet(pkgFiles, destDir, loadPkgKeysFile(engine.keysFile), {
              addonsDir,
              onProgress: (p) =>
                onProgress?.(
                  toOverall(p.percent),
                  `Extraindo ${p.pkgName} (${p.percent}%) — ${formatBytes(p.extractedBytes)} de ${formatBytes(p.totalBytes)}`
                )
            })
      addons = result.addons
      skippedCount = result.skipped.length
      gameRoot = this.resolveGameRoot(destDir, req)
    } catch (err) {
      // Não deixa um jogo extraído pela metade ocupando o disco
      fs.rmSync(destDir, { recursive: true, force: true })
      fs.rmSync(addonsDir, { recursive: true, force: true })
      throw err
    } finally {
      if (options.removeAfter) fs.rmSync(options.removeAfter, { recursive: true, force: true })
    }

    const entry = await this.importDirectory(gameRoot, game, req, `PKG: ${sourceLabel}`, (percent, label) =>
      onProgress?.(
        percent,
        percent >= 100 && skippedCount > 0
          ? `${label} — ${skippedCount} PKG(s) de mod ficaram de fora (para aplicar um, coloque-o na mesma pasta do jogo, fora da subpasta de mods)`
          : label
      )
    )

    // DLC encontrados nos PKGs entram na lista de patches/DLC do jogo
    const patchReq = this.getRequirements(game).find((r) => r.type === 'patch')
    if (patchReq) {
      for (const addon of addons) {
        if (fs.existsSync(addon.dir)) {
          await this.importPatch(addon.dir, fs.statSync(addon.dir), game, patchReq, undefined)
        }
      }
    }
    return entry
  }

  /**
   * Confere que a pasta é mesmo o jogo (arquivo marcador, ex.: eboot.bin) e desce até a pasta certa
   * quando o usuário escolheu a pasta "de cima".
   */
  private resolveGameRoot(dir: string, req: RomRequirement | undefined): string {
    if (!req?.markerFile) return dir
    const root = findMarkerRoot(dir, req.markerFile, 2)
    if (!root) {
      throw new Error(
        this.missingMarkerMessage(req, findFilesByExtension(dir, '.pkg', 3, 3).length > 0)
      )
    }
    return root
  }

  /** Pasta do jogo (dump). Registrada por referência: nada é copiado. */
  private async importDirectory(
    dir: string,
    game: CatalogGame,
    req: RomRequirement | undefined,
    extractedFromArchive: string | undefined,
    onProgress?: (percent: number, stageLabel: string) => void
  ): Promise<RomVaultEntry> {
    onProgress?.(94, 'Conferindo a pasta do jogo...')
    const { bytes, files } = await directorySize(dir, (count, total) =>
      onProgress?.(95, `Conferindo a pasta do jogo (${count} arquivos, ${formatBytes(total)})...`)
    )
    if (files === 0) {
      throw new Error(`A pasta "${dir}" está vazia ou não pôde ser lida.`)
    }

    const stat = fs.statSync(dir)
    const entry: RomVaultEntry = {
      filePath: dir,
      fileName: path.basename(dir),
      size: bytes,
      fileModifiedAt: stat.mtimeMs,
      ...this.pseudoHashes(`dir:${path.resolve(dir)}:${files}:${bytes}`),
      extension: '',
      scannedAt: new Date().toISOString(),
      assignedGameIds: [game.id],
      assignedRequirementIds: req ? [`${game.id}::${req.id}`] : [],
      extractedFromArchive,
      isDirectory: true,
      kind: 'main'
    }

    this.store.upsertRomVaultEntry(entry)
    onProgress?.(100, `Pasta do jogo pronta: ${entry.fileName} (${formatBytes(bytes)})`)
    return entry
  }

  /** Patch, atualização ou DLC: arquivo ou pasta guardados por referência para o jogo. */
  private async importPatch(
    pickedPath: string,
    stat: fs.Stats,
    game: CatalogGame,
    req: RomRequirement,
    onProgress?: (percent: number, stageLabel: string) => void
  ): Promise<RomVaultEntry> {
    const name = path.basename(pickedPath)
    onProgress?.(10, `Registrando patch ${name}...`)

    let size = stat.size
    let hashes: { sha1: string; md5: string }
    if (stat.isDirectory()) {
      const dirInfo = await directorySize(pickedPath)
      size = dirInfo.bytes
      hashes = this.pseudoHashes(`patchdir:${path.resolve(pickedPath)}:${dirInfo.files}:${dirInfo.bytes}`)
    } else {
      hashes = await this.computeFileHashes(pickedPath, stat.size > 64 * 1024 * 1024)
    }

    const entry: RomVaultEntry = {
      filePath: pickedPath,
      fileName: name,
      size,
      fileModifiedAt: stat.mtimeMs,
      sha1: hashes.sha1.toLowerCase(),
      md5: hashes.md5.toLowerCase(),
      extension: stat.isDirectory() ? '' : path.extname(pickedPath).toLowerCase(),
      scannedAt: new Date().toISOString(),
      assignedGameIds: [game.id],
      assignedRequirementIds: [`${game.id}::${req.id}`],
      isDirectory: stat.isDirectory(),
      kind: 'patch'
    }

    this.store.upsertRomVaultEntry(entry)
    onProgress?.(100, `Patch pronto: ${name} (${formatBytes(size)})`)
    return entry
  }

  private isPkgFile(filePath: string): boolean {
    if (!filePath.toLowerCase().endsWith('.pkg')) return false
    try {
      if (!fs.existsSync(filePath)) return false
      const stat = fs.statSync(filePath)
      if (stat.size < 0x1000) return false
      const fd = fs.openSync(filePath, 'r')
      const buf = Buffer.alloc(4)
      fs.readSync(fd, buf, 0, 4, 0)
      fs.closeSync(fd)
      return buf.readUInt32BE(0) === 0x7f434e54
    } catch {
      return false
    }
  }

  /**
   * Localiza a pasta do dump do jogo PS4 já desempacotada (com eboot.bin), seja no Cofre (pkg-extraido)
   * ou em uma pasta vinculada pelo usuário.
   */
  private findGameDumpDir(game: CatalogGame): string | null {
    // 1. Cofre padrão do RecompHUB (pkg-extraido)
    const vaultPkgDir = path.join(this.gameVaultDir(game), 'pkg-extraido')
    if (fs.existsSync(vaultPkgDir) && fs.existsSync(path.join(vaultPkgDir, 'eboot.bin'))) {
      return vaultPkgDir
    }

    // 2. Itens já registrados no cofre para este jogo
    const vaultEntries = this.getVaultEntries()
    for (const entry of vaultEntries) {
      if (entry.assignedGameIds?.includes(game.id) && entry.isDirectory && fs.existsSync(entry.filePath)) {
        if (fs.existsSync(path.join(entry.filePath, 'eboot.bin'))) {
          return entry.filePath
        }
        const marker = findMarkerRoot(entry.filePath, 'eboot.bin', 2)
        if (marker) return marker
      }
    }

    // 3. Jogo instalado na biblioteca
    const installed =
      typeof this.store.getInstalledGame === 'function'
        ? this.store.getInstalledGame(game.id)
        : undefined
    if (installed?.installDir) {
      const gd = path.join(installed.installDir, 'game_dump')
      if (fs.existsSync(gd) && fs.existsSync(path.join(gd, 'eboot.bin'))) {
        try {
          return fs.realpathSync(gd)
        } catch {
          return gd
        }
      }
    }

    return null
  }

  /**
   * Extrai um ou mais arquivos .pkg de patch/update/DLC do PS4 diretamente sobre o dump do jogo
   * já existente no Cofre (pkg-extraido), atualizando eboot.bin, módulos e assets.
   */
  private async applyPatchPkgs(
    pkgFiles: string[],
    destDir: string,
    game: CatalogGame,
    patchReq: RomRequirement,
    sourceLabel: string,
    onProgress?: (percent: number, stageLabel: string) => void,
    options: { removeAfter?: string; progressFrom?: number; recordFilePath?: string } = {}
  ): Promise<RomVaultEntry> {
    const engine = await this.resolvePkgEngine()
    const gameDir = this.gameVaultDir(game)
    const addonsDir = path.join(gameDir, 'dlc-pkg')
    fs.mkdirSync(addonsDir, { recursive: true })

    const from = options.progressFrom ?? 3
    const to = 94
    onProgress?.(from, `Lendo ${pkgFiles.length} arquivo(s) .pkg de atualização...`)
    let addons: { dir: string }[] = []
    let skippedCount = 0

    try {
      const toOverall = (percent: number): number => Math.round(from + (percent / 100) * (to - from))
      const result =
        engine.kind === 'external'
          ? await extractPkgSetExternal(pkgFiles, destDir, engine.file, {
              addonsDir,
              allowPatchOnly: true,
              onProgress: (p) =>
                onProgress?.(
                  toOverall(p.percent),
                  `Aplicando atualização ${p.pkgName} (${p.percent}%)${p.detail ? ` — ${p.detail}` : ''}`
                )
            })
          : await extractPkgSet(pkgFiles, destDir, loadPkgKeysFile(engine.keysFile), {
              addonsDir,
              allowPatchOnly: true,
              onProgress: (p) =>
                onProgress?.(
                  toOverall(p.percent),
                  `Aplicando atualização ${p.pkgName} (${p.percent}%) — ${formatBytes(p.extractedBytes)} de ${formatBytes(p.totalBytes)}`
                )
            })
      addons = result.addons
      skippedCount = result.skipped.length
    } finally {
      if (options.removeAfter) fs.rmSync(options.removeAfter, { recursive: true, force: true })
    }

    // Atualiza metadados do dump principal no Cofre (tamanho de bytes e mtime)
    const { bytes } = await directorySize(destDir)
    const stat = fs.statSync(destDir)
    const vaultEntries = this.getVaultEntries()
    const mainEntry = vaultEntries.find((e) => e.filePath === destDir)
    if (mainEntry) {
      this.store.upsertRomVaultEntry({
        ...mainEntry,
        size: bytes,
        fileModifiedAt: stat.mtimeMs,
        scannedAt: new Date().toISOString()
      })
    }

    // Registra o patch na lista de Patches / DLC
    const finalFilePath = options.recordFilePath || pkgFiles[0]
    const finalFileName = sourceLabel || path.basename(finalFilePath)
    const statForFinal = fs.existsSync(finalFilePath) ? fs.statSync(finalFilePath) : null
    const isDir = statForFinal ? statForFinal.isDirectory() : false
    const totalPkgSize = pkgFiles.reduce((acc, f) => {
      try {
        return acc + fs.statSync(f).size
      } catch {
        return acc
      }
    }, 0)
    const fileSize = statForFinal && !isDir ? statForFinal.size : totalPkgSize || bytes

    const patchEntry: RomVaultEntry = {
      filePath: finalFilePath,
      fileName: finalFileName,
      size: fileSize,
      fileModifiedAt: statForFinal?.mtimeMs || Date.now(),
      ...this.pseudoHashes(`patch-applied:${game.id}:${finalFileName}:${Date.now()}`),
      extension: isDir ? '' : path.extname(finalFilePath).toLowerCase(),
      scannedAt: new Date().toISOString(),
      assignedGameIds: [game.id],
      assignedRequirementIds: [`${game.id}::${patchReq.id}`],
      isDirectory: isDir,
      kind: 'patch'
    }
    this.store.upsertRomVaultEntry(patchEntry)

    // DLCs encontrados entram na lista de patches/DLC do jogo
    for (const addon of addons) {
      if (fs.existsSync(addon.dir)) {
        await this.importPatch(addon.dir, fs.statSync(addon.dir), game, patchReq, undefined)
      }
    }

    onProgress?.(
      100,
      `Atualização aplicada com sucesso: ${finalFileName}${skippedCount > 0 ? ` (${skippedCount} PKGs de mod ignorados)` : ''}!`
    )
    return patchEntry
  }

  /** Extrai qualquer formato suportado, sempre em fluxo (sem carregar o arquivo na memória). */
  private async extractArchive(
    archivePath: string,
    destDir: string,
    onPercent?: (pct: number) => void
  ): Promise<void> {
    const lower = archivePath.toLowerCase()
    fs.mkdirSync(destDir, { recursive: true })

    if (lower.endsWith('.zip')) {
      await extractZipStreaming(archivePath, destDir, {
        onProgress: (p) => onPercent?.(p.percent)
      })
    } else if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
      onPercent?.(10)
      await tar.x({ file: archivePath, cwd: destDir })
      onPercent?.(100)
    } else if (lower.endsWith('.7z') || lower.endsWith('.rar') || lower.endsWith('.tar.xz')) {
      await this.extractWithSystemTool(archivePath, destDir, onPercent)
    } else {
      throw new Error(`Formato compactado não suportado: ${path.basename(archivePath)}`)
    }
  }

  private async extractRomFromCompressedFile(
    archivePath: string,
    game: CatalogGame,
    req?: RomRequirement,
    onPercent?: (pct: number) => void
  ): Promise<string> {
    const gameVaultSubdir = this.gameVaultDir(game)
    fs.mkdirSync(gameVaultSubdir, { recursive: true })

    await this.extractArchive(archivePath, gameVaultSubdir, onPercent)

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

  private collectRomFiles(
    dir: string,
    maxDepth = 4,
    currentDepth = 0,
    skipDirs: Set<string> = new Set()
  ): string[] {
    if (currentDepth > maxDepth) return []
    if (skipDirs.has(path.resolve(dir))) return []
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
        files.push(...this.collectRomFiles(fullPath, maxDepth, currentDepth + 1, skipDirs))
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
    const requirements = this.getRequirements(game)
    const localEntries = this.getVaultEntries()

    const matchedRequirements = requirements.map((req) => {
      if (req.type === 'patch') {
        const reqKey = `${game.id}::${req.id}`
        const patches = localEntries.filter((e) => e.assignedRequirementIds?.includes(reqKey))
        return {
          requirement: req,
          status: patches.length > 0 ? ('local_vault' as const) : ('missing' as const),
          localEntry: patches[0],
          localEntries: patches
        }
      }

      const localMatch = this.findLocalMatch(req, game, localEntries)
      // Um item registrado antes das conferências (ou que mudou no disco) pode não ser o jogo
      if (localMatch?.isDirectory && req.markerFile && !findMarkerRoot(localMatch.filePath, req.markerFile, 2)) {
        return {
          requirement: req,
          status: 'missing' as const,
          problem: this.missingMarkerMessage(
            req,
            findFilesByExtension(localMatch.filePath, '.pkg', 3, 3).length > 0
          )
        }
      }
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
    // Se o usuário escolheu mais de um arquivo/pasta para o mesmo requisito, vale o mais recente
    // ("Alterar" precisa realmente trocar o item usado).
    localEntries = [...localEntries].sort((a, b) =>
      (b.scannedAt || '').localeCompare(a.scannedAt || '')
    )
    const byExplicitReq = localEntries.find(
      (e) =>
        e.kind !== 'patch' &&
        e.assignedRequirementIds?.includes(reqKey) &&
        fs.existsSync(e.filePath)
    )
    if (byExplicitReq) return byExplicitReq

    // Patches/atualizações nunca valem como o jogo principal; pastas só servem a requisitos de pasta
    const wantsFolder = req.type === 'folder'
    localEntries = localEntries.filter(
      (e) => e.kind !== 'patch' && Boolean(e.isDirectory) === wantsFolder
    )

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
