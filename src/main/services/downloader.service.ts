import * as fs from 'fs'
import * as path from 'path'
import { spawn } from 'child_process'
import * as tar from 'tar'
import {
  CatalogGame,
  DownloadTaskProgress,
  InstalledGame,
  RomVaultEntry
} from '../../shared/types'
import { StoreService } from './store.service'
import { CatalogService } from './catalog.service'
import { RomVaultService } from './rom-vault.service'
import { RecipeService } from './recipe.service'
import { isInstallerAsset } from './asset-selector'
import { ensureFreeSpace, extractZipStreaming } from './archive.service'

export class DownloaderService {
  private tasks = new Map<string, DownloadTaskProgress>()
  private activeControllers = new Map<string, AbortController>()
  private progressListeners: ((progress: DownloadTaskProgress) => void)[] = []
  private libraryListeners: ((library: InstalledGame[]) => void)[] = []
  private tasksListListeners: ((tasks: DownloadTaskProgress[]) => void)[] = []

  constructor(
    private store: StoreService,
    private catalog: CatalogService,
    private romVault: RomVaultService,
    private recipeService: RecipeService
  ) {}

  public onProgress(cb: (progress: DownloadTaskProgress) => void): () => void {
    this.progressListeners.push(cb)
    return () => {
      this.progressListeners = this.progressListeners.filter((l) => l !== cb)
    }
  }

  public onLibraryChange(cb: (library: InstalledGame[]) => void): () => void {
    this.libraryListeners.push(cb)
    return () => {
      this.libraryListeners = this.libraryListeners.filter((l) => l !== cb)
    }
  }

  public onTasksUpdated(cb: (tasks: DownloadTaskProgress[]) => void): () => void {
    this.tasksListListeners.push(cb)
    return () => {
      this.tasksListListeners = this.tasksListListeners.filter((l) => l !== cb)
    }
  }

  private emitProgress(task: DownloadTaskProgress): void {
    this.tasks.set(task.taskId, { ...task, logs: [...task.logs] })
    for (const listener of this.progressListeners) {
      listener(task)
    }
  }

  private emitTasksUpdated(): void {
    const list = this.getActiveTasks()
    for (const listener of this.tasksListListeners) {
      listener(list)
    }
  }

  public emitLibraryUpdated(): void {
    const lib = this.store.getLibrary()
    for (const listener of this.libraryListeners) {
      listener(lib)
    }
  }

  public getActiveTasks(): DownloadTaskProgress[] {
    return Array.from(this.tasks.values())
  }

  public clearFinishedTasks(): DownloadTaskProgress[] {
    for (const [id, task] of this.tasks.entries()) {
      if (['READY_TO_PLAY', 'NEEDS_ROM', 'ERROR', 'CANCELLED'].includes(task.stage)) {
        this.tasks.delete(id)
        this.activeControllers.delete(id)
      }
    }
    this.emitTasksUpdated()
    return this.getActiveTasks()
  }

  public clearTask(taskId: string): DownloadTaskProgress[] {
    const task = this.tasks.get(taskId)
    if (task && ['READY_TO_PLAY', 'NEEDS_ROM', 'ERROR', 'CANCELLED'].includes(task.stage)) {
      this.tasks.delete(taskId)
      this.activeControllers.delete(taskId)
      this.emitTasksUpdated()
    }
    return this.getActiveTasks()
  }

  public async cancelInstall(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId)
    if (!task) return false

    const isFinished = ['READY_TO_PLAY', 'NEEDS_ROM', 'ERROR', 'CANCELLED'].includes(task.stage)
    if (isFinished) return false

    const controller = this.activeControllers.get(taskId)
    if (controller) {
      controller.abort()
      this.activeControllers.delete(taskId)
    }

    task.stage = 'CANCELLED'
    task.stageLabel = 'Download cancelado pelo usuário'
    task.speedBytesPerSec = 0
    task.completedAt = new Date().toISOString()
    task.logs.push('Instalação e download cancelados pelo usuário.')
    this.emitProgress(task)
    this.emitTasksUpdated()
    return true
  }

  public async startInstall(
    game: CatalogGame,
    pickedRomPath?: string,
    requirementId?: string
  ): Promise<{ taskId: string }> {
    const taskId = `install_${game.id}_${Date.now()}`
    const controller = new AbortController()
    this.activeControllers.set(taskId, controller)

    const initialTask: DownloadTaskProgress = {
      taskId,
      gameId: game.id,
      gameTitle: game.title,
      projectName: game.projectName,
      consoleBadge: game.consoleBadge,
      imageUrl: game.imageUrl,
      stage: pickedRomPath ? 'EXTRACTING_ISO' : 'RESOLVING_RELEASE',
      stageLabel: pickedRomPath
        ? `Preparando ISO/ROM: ${path.basename(pickedRomPath)}...`
        : 'Consultando GitHub Releases...',
      portProgress: 0,
      overallProgress: 2,
      downloadedBytes: 0,
      totalBytes: 0,
      speedBytesPerSec: 0,
      logs: [`Iniciando instalação de ${game.title} (${game.projectName})`],
      startedAt: new Date().toISOString()
    }

    this.emitProgress(initialTask)
    this.emitTasksUpdated()

    this.runInstallPipeline(taskId, game, controller, pickedRomPath, requirementId).catch(
      (err) => {
        if (
          controller.signal.aborted ||
          err?.name === 'AbortError' ||
          err?.message?.includes('cancelado')
        ) {
          return
        }
        const current = this.tasks.get(taskId) || initialTask
        current.stage = 'ERROR'
        current.stageLabel = 'Erro na instalação'
        current.error = err?.message || String(err)
        current.logs.push(`[ERRO] ${current.error}`)
        this.emitProgress(current)
        this.emitTasksUpdated()
      }
    ).finally(() => {
      this.activeControllers.delete(taskId)
    })

    return { taskId }
  }

  public async startRomImport(
    game: CatalogGame,
    pickedRomPath: string,
    requirementId?: string
  ): Promise<RomVaultEntry> {
    const taskId = `rom_import_${game.id}_${Date.now()}`
    const task: DownloadTaskProgress = {
      taskId,
      gameId: game.id,
      gameTitle: game.title,
      projectName: game.projectName,
      consoleBadge: game.consoleBadge,
      imageUrl: game.imageUrl,
      stage: 'EXTRACTING_ISO',
      stageLabel: `Preparando arquivo: ${path.basename(pickedRomPath)}...`,
      portProgress: 0,
      overallProgress: 2,
      downloadedBytes: 0,
      totalBytes: 0,
      speedBytesPerSec: 0,
      logs: [
        `Importando arquivo de ISO/ROM selecionado: ${path.basename(pickedRomPath)}`
      ],
      startedAt: new Date().toISOString()
    }

    this.emitProgress(task)

    try {
      const entry = await this.romVault.importRomOrArchiveForGame(
        pickedRomPath,
        game,
        requirementId,
        (pct, label) => {
          task.stage = 'EXTRACTING_ISO'
          task.stageLabel = label
          task.portProgress = pct
          task.overallProgress = Math.max(2, Math.min(88, Math.round(pct * 0.88)))
          this.emitProgress(task)
        }
      )

      task.logs.push(
        `ISO/ROM pronta no Cofre: ${entry.fileName} [SHA-1: ${entry.sha1.slice(0, 10)}...]`
      )

      // If the game is already installed, re-apply recipe immediately
      const installed = this.store.getInstalledGame(game.id)
      if (installed && fs.existsSync(installed.installDir)) {
        task.stage = 'APPLYING_RECIPE'
        task.stageLabel = 'Vinculando ISO/ROM ao jogo instalado...'
        task.overallProgress = 92
        this.emitProgress(task)

        const availability = await this.romVault.checkRomAvailability(game)
        const recipeRes = await this.recipeService.applyRecipe(
          game,
          installed.installDir,
          availability,
          (msg) => {
            task.logs.push(msg)
            this.emitProgress(task)
          }
        )

        this.store.upsertInstalledGame({
          ...installed,
          executablePath: recipeRes.executablePath || installed.executablePath,
          requiresCompatibilityLayer: recipeRes.requiresCompatibilityLayer,
          status: recipeRes.status,
          romPaired: recipeRes.romPaired,
          pairedRomPaths: recipeRes.pairedRomPaths,
          portableMode: recipeRes.portableMode,
          pairedPatchPaths: recipeRes.pairedPatchPaths,
          aliasLinkPaths: recipeRes.aliasLinkPaths,
          launchArgs: game.recipe?.launchArgs ?? installed.launchArgs,
          recipeLogs: [...installed.recipeLogs, ...recipeRes.logs]
        })
        this.emitLibraryUpdated()

        task.stage =
          recipeRes.status === 'READY_TO_PLAY' ? 'READY_TO_PLAY' : 'NEEDS_ROM'
        task.stageLabel =
          recipeRes.status === 'READY_TO_PLAY'
            ? 'ISO/ROM pareada — Pronto para Jogar!'
            : 'ISO/ROM importada'
      } else {
        task.stage = 'NEEDS_ROM'
        task.stageLabel = `ISO/ROM validada (${entry.fileName}) — Pronta para instalação`
      }

      task.overallProgress = 100
      task.completedAt = new Date().toISOString()
      this.emitProgress(task)
      return entry
    } catch (err: any) {
      task.stage = 'ERROR'
      task.stageLabel = 'Falha ao descompactar/validar ISO'
      task.error = err?.message || String(err)
      task.logs.push(`[ERRO] ${task.error}`)
      this.emitProgress(task)
      throw err
    }
  }

  private async runInstallPipeline(
    taskId: string,
    game: CatalogGame,
    controller: AbortController,
    pickedRomPath?: string,
    requirementId?: string
  ): Promise<void> {
    const task = this.tasks.get(taskId)!
    const log = (msg: string): void => {
      task.logs.push(msg)
      this.emitProgress(task)
    }

    let downloadedArchivePath = ''
    let installDir = ''

    try {
      if (controller.signal.aborted) {
        throw new Error('Download cancelado pelo usuário.')
      }

      // Step 0: If user selected an ISO/ROM or archive (.7z/.rar/.zip), extract & import it first with progress
      const hasIsoStep = Boolean(pickedRomPath)
      if (pickedRomPath) {
        log(`Processando ISO/ROM selecionada: ${path.basename(pickedRomPath)}`)
        const entry = await this.romVault.importRomOrArchiveForGame(
          pickedRomPath,
          game,
          requirementId,
          (pct, label) => {
            if (controller.signal.aborted) return
            task.stage = 'EXTRACTING_ISO'
            task.stageLabel = label
            task.portProgress = pct
            task.overallProgress = Math.max(2, Math.min(45, Math.round(pct * 0.45)))
            this.emitProgress(task)
          }
        )
        if (controller.signal.aborted) throw new Error('Download cancelado pelo usuário.')
        log(
          `ISO/ROM pronta no Cofre: ${entry.fileName} (${(entry.size / (1024 * 1024)).toFixed(1)} MB)`
        )
      }

      if (controller.signal.aborted) throw new Error('Download cancelado pelo usuário.')

      // Step 1: Resolve GitHub release asset
      task.stage = 'RESOLVING_RELEASE'
      task.stageLabel = 'Consultando GitHub Releases...'
      task.overallProgress = hasIsoStep ? 46 : 5
      this.emitProgress(task)

      const release = await this.catalog.resolveRelease(game)
      if (controller.signal.aborted) throw new Error('Download cancelado pelo usuário.')
      if (!release.selectedAsset) {
        throw new Error(
          `${release.selectionReason} (release ${release.tagName} de ${release.repoFullName}).`
        )
      }

      log(`Release localizada: ${release.tagName} — ${release.selectionReason}`)
      if (isInstallerAsset(release.selectedAsset.name)) {
        log(
          `Aviso: "${release.selectedAsset.name}" é um instalador próprio do port (não o jogo já pronto). Depois de instalar, selecione o executável do jogo manualmente.`
        )
      }

      const settings = this.store.getSettings()
      const folderSlug = `${game.projectName}_${game.id}`
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .slice(0, 64)
      installDir = path.join(settings.installRootPath, folderSlug)
      const tempDir = path.join(settings.installRootPath, '.tmp_downloads')

      if (!fs.existsSync(installDir)) {
        fs.mkdirSync(installDir, { recursive: true })
      }
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true })
      }

      const assetFileName = release.selectedAsset.name
      downloadedArchivePath = path.join(tempDir, `${taskId}_${assetFileName}`)

      // O arquivo baixado e a pasta extraída existem ao mesmo tempo: calcula com folga
      if (release.selectedAsset.size > 0) {
        await ensureFreeSpace(
          settings.installRootPath,
          release.selectedAsset.size * 2 + 256 * 1024 * 1024,
          `instalar ${assetFileName}`
        )
      }

      if (controller.signal.aborted) throw new Error('Download cancelado pelo usuário.')

      // Step 2: Download Port from GitHub
      task.stage = 'DOWNLOADING_PORT'
      task.stageLabel = `Baixando port: ${assetFileName}...`
      this.emitProgress(task)

      let portTotal = release.selectedAsset.size || 0
      const baseOffset = hasIsoStep ? 46 : 5
      const dlWeight = hasIsoStep ? 34 : 70

      await this.downloadFileWithProgress(
        release.selectedAsset.browserDownloadUrl,
        downloadedArchivePath,
        (received, total, speed) => {
          if (total > 0) portTotal = total
          task.downloadedBytes = received
          task.totalBytes = portTotal
          task.speedBytesPerSec = speed
          task.portProgress =
            portTotal > 0 ? Math.round((received / portTotal) * 100) : 50
          task.overallProgress = Math.min(
            80,
            baseOffset + Math.round((task.portProgress / 100) * dlWeight)
          )
          this.emitProgress(task)
        },
        controller.signal
      )

      if (controller.signal.aborted) throw new Error('Download cancelado pelo usuário.')

      task.portProgress = 100
      task.speedBytesPerSec = 0
      log(`Download do port concluído: ${assetFileName}`)

      // Step 3: Extract Archive into installDir
      task.stage = 'EXTRACTING_ARCHIVE'
      task.stageLabel = `Extraindo ${assetFileName}...`
      task.overallProgress = 84
      this.emitProgress(task)

      await this.extractOrPlaceAsset(
        downloadedArchivePath,
        assetFileName,
        installDir,
        log,
        (pct) => {
          if (controller.signal.aborted) return
          task.stageLabel = `Extraindo ${assetFileName} (${pct}%)...`
          task.overallProgress = 84 + Math.round(pct * 0.07)
          this.emitProgress(task)
        }
      )

      if (controller.signal.aborted) throw new Error('Download cancelado pelo usuário.')
      await this.extractNestedArchivesIfNeeded(installDir, log)

      try {
        if (fs.existsSync(downloadedArchivePath)) {
          fs.unlinkSync(downloadedArchivePath)
        }
      } catch {
        // Ignore
      }

      if (controller.signal.aborted) throw new Error('Download cancelado pelo usuário.')

      // Step 4: Check local ROM/ISO availability and run Post-Install Recipe Engine
      const availability = await this.romVault.checkRomAvailability(game)

      task.stage =
        game.inferredFamily === 'AssetExtractor'
          ? 'EXTRACTING_ASSETS'
          : 'APPLYING_RECIPE'
      task.stageLabel = `Aplicando receita ${game.inferredFamily} e pareando ISO/ROM...`
      task.overallProgress = 92
      this.emitProgress(task)

      const recipeResult = await this.recipeService.applyRecipe(
        game,
        installDir,
        availability,
        (recipeLog) => {
          log(recipeLog)
        }
      )

      if (controller.signal.aborted) throw new Error('Download cancelado pelo usuário.')

      // Step 5: Persist InstalledGame in Library
      const installedGame: InstalledGame = {
        id: game.id,
        gameId: game.id,
        title: game.title,
        projectName: game.projectName,
        repoFullName: game.repoFullName,
        console: game.console,
        consoleBadge: game.consoleBadge,
        version: release.tagName || game.version,
        imageUrl: game.imageUrl,
        installDir,
        executablePath: recipeResult.executablePath,
        requiresCompatibilityLayer: recipeResult.requiresCompatibilityLayer,
        recipeFamily: game.recipe?.family || game.inferredFamily,
        status: recipeResult.status,
        romPaired: recipeResult.romPaired,
        pairedRomPaths: recipeResult.pairedRomPaths,
        portableMode: recipeResult.portableMode,
        pairedPatchPaths: recipeResult.pairedPatchPaths,
        aliasLinkPaths: recipeResult.aliasLinkPaths,
        launchArgs: game.recipe?.launchArgs,
        playTimeSeconds: 0,
        installedAt: new Date().toISOString(),
        recipeLogs: recipeResult.logs
      }

      this.store.upsertInstalledGame(installedGame)
      this.emitLibraryUpdated()

      // Step 6: Mark task completed
      task.stage =
        recipeResult.status === 'READY_TO_PLAY' ? 'READY_TO_PLAY' : 'NEEDS_ROM'
      task.stageLabel =
        recipeResult.status === 'READY_TO_PLAY'
          ? 'Pronto para Jogar (ISO/ROM Pareada)!'
          : 'Port instalado — Selecione o caminho da ISO/ROM para jogar'
      task.overallProgress = 100
      task.completedAt = new Date().toISOString()
      this.emitProgress(task)
      this.emitTasksUpdated()
    } catch (err: any) {
      const isCancelled =
        controller.signal.aborted ||
        err?.name === 'AbortError' ||
        err?.message?.includes('cancelado')

      if (downloadedArchivePath) {
        try {
          if (fs.existsSync(downloadedArchivePath)) {
            fs.unlinkSync(downloadedArchivePath)
          }
        } catch {}
      }

      if (isCancelled) {
        if (installDir) {
          try {
            if (fs.existsSync(installDir)) {
              fs.rmSync(installDir, { recursive: true, force: true })
            }
          } catch {}
        }

        task.stage = 'CANCELLED'
        task.stageLabel = 'Download cancelado pelo usuário'
        task.speedBytesPerSec = 0
        task.completedAt = new Date().toISOString()
        task.logs.push('Instalação e download cancelados pelo usuário.')
        this.emitProgress(task)
        this.emitTasksUpdated()
        return
      }

      throw err
    }
  }

  private async downloadFileWithProgress(
    url: string,
    destPath: string,
    onChunk: (receivedBytes: number, totalBytes: number, speedBps: number) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'RecompHub-Launcher/1.0'
      },
      redirect: 'follow',
      signal
    })

    if (!response.ok || !response.body) {
      throw new Error(
        `Falha no download (${response.status} ${response.statusText}): ${url}`
      )
    }

    const totalBytes = Number(response.headers.get('content-length') || 0)
    let receivedBytes = 0
    const startTime = Date.now()
    let lastEmit = 0

    const fileStream = fs.createWriteStream(destPath)
    const reader = response.body.getReader()

    try {
      while (true) {
        if (signal?.aborted) {
          try {
            await reader.cancel()
          } catch {}
          fileStream.destroy()
          throw new Error('Download cancelado pelo usuário.')
        }

        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          // Respeita o ritmo do disco: sem isso, um download de vários GB acumularia tudo na memória
          if (!fileStream.write(Buffer.from(value))) {
            await new Promise<void>((resolve) => fileStream.once('drain', () => resolve()))
          }
          receivedBytes += value.byteLength

          const now = Date.now()
          if (now - lastEmit >= 120 || receivedBytes === totalBytes) {
            const elapsedSec = Math.max(0.1, (now - startTime) / 1000)
            const speedBps = Math.round(receivedBytes / elapsedSec)
            onChunk(receivedBytes, totalBytes, speedBps)
            lastEmit = now
          }
        }
      }
    } finally {
      await new Promise<void>((resolve) => fileStream.end(resolve))
    }
  }

  /**
   * Alguns releases vêm "embrulhados" (ex.: um .zip que só contém um linux.tar.gz).
   * Se depois da extração não existir nenhum executável, extrai os pacotes internos.
   */
  private async extractNestedArchivesIfNeeded(
    installDir: string,
    log: (m: string) => void
  ): Promise<void> {
    if (this.recipeService.findMainExecutable(installDir).executablePath) return

    const nestedPattern = /\.(zip|7z|rar|tar\.gz|tgz|tar\.xz)$/i
    const nested: string[] = []
    const walk = (dir: string, depth: number): void => {
      if (depth > 2) return
      let entries: fs.Dirent[] = []
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full, depth + 1)
        else if (nestedPattern.test(entry.name)) nested.push(full)
      }
    }
    walk(installDir, 0)

    for (const archive of nested) {
      log(`Pacote interno encontrado (${path.basename(archive)}); extraindo...`)
      try {
        await this.extractOrPlaceAsset(archive, path.basename(archive), path.dirname(archive), log)
        fs.unlinkSync(archive)
      } catch (err: any) {
        log(`Aviso ao extrair pacote interno ${path.basename(archive)}: ${err?.message || err}`)
      }
    }
  }

  private async extractOrPlaceAsset(
    archivePath: string,
    originalAssetName: string,
    installDir: string,
    log: (m: string) => void,
    onPercent?: (pct: number) => void
  ): Promise<void> {
    const lower = originalAssetName.toLowerCase()

    if (lower.endsWith('.zip')) {
      log(`Descompactando arquivo ZIP: ${originalAssetName}`)
      // Em fluxo: aceita zips acima de 2 GB e não trava a interface durante a extração
      await extractZipStreaming(archivePath, installDir, {
        onProgress: (p) => onPercent?.(p.percent)
      })
      return
    }

    if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
      log(`Descompactando arquivo TAR.GZ: ${originalAssetName}`)
      await tar.x({
        file: archivePath,
        cwd: installDir
      })
      return
    }

    if (
      lower.endsWith('.tar.xz') ||
      lower.endsWith('.7z') ||
      lower.endsWith('.rar')
    ) {
      log(`Extraindo pacote ${originalAssetName} via utilitário do sistema...`)
      const candidates: { cmd: string; args: string[] }[] = lower.endsWith('.rar')
        ? [
            { cmd: 'unrar', args: ['x', '-o+', '-y', archivePath, `${installDir}/`] },
            { cmd: '7z', args: ['x', archivePath, `-o${installDir}`, '-y'] },
            { cmd: 'bsdtar', args: ['-xf', archivePath, '-C', installDir] }
          ]
        : lower.endsWith('.7z')
          ? [
              { cmd: '7z', args: ['x', archivePath, `-o${installDir}`, '-y'] },
              { cmd: '7za', args: ['x', archivePath, `-o${installDir}`, '-y'] },
              { cmd: 'bsdtar', args: ['-xf', archivePath, '-C', installDir] }
            ]
          : [
              { cmd: 'tar', args: ['-xf', archivePath, '-C', installDir] },
              { cmd: 'bsdtar', args: ['-xf', archivePath, '-C', installDir] }
            ]

      let extracted = false
      let lastErr = ''
      for (const candidate of candidates) {
        try {
          await new Promise<void>((resolve, reject) => {
            const proc = spawn(candidate.cmd, candidate.args)
            proc.on('error', (err) => reject(err))
            proc.on('close', (code) => {
              if (code === 0) resolve()
              else reject(new Error(`${candidate.cmd} retornou código ${code}`))
            })
          })
          extracted = true
          log(`Pacote ${originalAssetName} extraído com sucesso (${candidate.cmd}).`)
          break
        } catch (err: any) {
          lastErr = err?.message || String(err)
        }
      }

      if (!extracted) {
        throw new Error(
          `Não foi possível extrair ${originalAssetName}: ${lastErr}`
        )
      }
      return
    }

    const destExec = path.join(installDir, originalAssetName)
    fs.copyFileSync(archivePath, destExec)
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(destExec, 0o755)
      } catch {
        // Ignore
      }
    }
    log(`Binário direto posicionado em: ${originalAssetName}`)
  }
}
