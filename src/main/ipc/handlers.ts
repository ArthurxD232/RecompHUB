import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { StoreService } from '../services/store.service'
import { CatalogService } from '../services/catalog.service'
import { RomVaultService } from '../services/rom-vault.service'
import { RecipeService } from '../services/recipe.service'
import { DownloaderService } from '../services/downloader.service'
import { RunnerService } from '../services/runner.service'
import { CommunityService } from '../services/community.service'
import { SteamService } from '../services/steam.service'
import { findExternalPkgExtractor, findPkgKeysFile, loadPkgKeysFile, probePkgExtractor } from '../services/pkg'
import {
  CatalogGame,
  InstalledGame,
  PkgExtractorStatus,
  PkgKeysStatus,
  SubmitPortPayload,
  UninstallGameOptions
} from '../../shared/types'

export function registerIpcHandlers(
  getMainWindow: () => BrowserWindow | null,
  services: {
    store: StoreService
    catalog: CatalogService
    romVault: RomVaultService
    recipe: RecipeService
    downloader: DownloaderService
    runner: RunnerService
    community: CommunityService
    steam: SteamService
  }
): void {
  const { store, catalog, romVault, recipe, downloader, runner, community, steam } = services

  const findGameById = async (gameId: string): Promise<CatalogGame> => {
    const { games } = await catalog.getCatalog(false)
    for (const g of games) {
      if (g.id === gameId || g.canonicalId === gameId) {
        return g
      }
      if (g.ports) {
        const port = g.ports.find((p) => p.id === gameId)
        if (port) {
          return {
            ...g,
            ...port,
            id: port.id,
            recipe: port.recipe || g.recipe
          }
        }
      }
    }

    // Also search in community ports!
    const { ports: communityPorts } = await community.getCommunityPorts(false)
    for (const g of communityPorts) {
      if (g.id === gameId || g.canonicalId === gameId) {
        return g
      }
      if (g.ports) {
        const port = g.ports.find((p) => p.id === gameId)
        if (port) {
          return {
            ...g,
            ...port,
            id: port.id,
            recipe: port.recipe || g.recipe
          }
        }
      }
    }

    throw new Error(`Jogo '${gameId}' não encontrado no catálogo.`)
  }

  // Forward background events to renderer
  downloader.onProgress((progress) => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('event:downloadProgress', progress)
    }
  })

  downloader.onLibraryChange((lib) => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('event:libraryUpdated', lib)
    }
  })

  downloader.onTasksUpdated((tasks) => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('event:downloadsUpdated', tasks)
    }
  })

  // Catalog
  catalog.onUpdated((result) => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('event:catalogUpdated', result)
    }
  })

  // Community Ports
  community.onUpdated((result) => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('event:communityUpdated', result)
    }
  })

  ipcMain.handle('catalog:get', async (_e, forceRefresh?: boolean) => {
    return catalog.getCatalog(Boolean(forceRefresh))
  })

  ipcMain.handle('catalog:resolveRelease', async (_e, gameId: string) => {
    const game = await findGameById(gameId)
    return catalog.resolveRelease(game)
  })

  ipcMain.handle('community:get', async (_e, forceRefresh?: boolean) => {
    return community.getCommunityPorts(Boolean(forceRefresh))
  })

  ipcMain.handle('community:inspectRepo', async (_e, githubUrl: string) => {
    return community.inspectGitHubRepo(githubUrl)
  })

  ipcMain.handle('community:generateIssueUrl', async (_e, payload: SubmitPortPayload) => {
    return community.generateCommunityIssueUrl(payload)
  })

  // ROM Vault & Per-Game ISO/ROM Selection (supports raw ISO/ROM or .zip/.7z/.rar/.tar.gz)
  ipcMain.handle('vault:getEntries', async () => {
    return romVault.getVaultEntries()
  })

  ipcMain.handle('vault:scan', async (_e, customDir?: string) => {
    return romVault.scanDirectory(customDir, (progress) => {
      const win = getMainWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('event:vaultScanProgress', progress)
      }
    })
  })

  ipcMain.handle('vault:checkAvailability', async (_e, gameId: string) => {
    const game = await findGameById(gameId)
    return romVault.checkRomAvailability(game)
  })

  const openRomPickerDialog = async (
    game: CatalogGame,
    requirementId?: string
  ): Promise<string | null> => {
    const win = getMainWindow()
    const req =
      game.recipe?.requirements.find((r) => r.id === requirementId) ||
      game.recipe?.requirements[0]

    // Jogos que são uma pasta (dumps de PS4...): pasta, .pkg ou arquivo compactado
    if (req?.type === 'folder') {
      const choice = await dialog.showMessageBox(win!, {
        type: 'question',
        title: 'Escolher o jogo',
        message: `Como está o seu ${game.title}?`,
        detail:
          'O port precisa do jogo extraído: uma pasta com o eboot.bin dentro.\n\n• Pasta: se já está extraída, nada é copiado. Se a pasta tiver arquivos .pkg (jogo e patches), o RecompHUB extrai sozinho, usando o PKG Extractor que você já tem instalado (ou o seu arquivo de chaves), conforme Configurações.\n• Arquivo .pkg: extrai esse pacote.\n• Arquivo compactado (.zip, .7z, .rar): é extraído para o Cofre e precisa de espaço livre.',
        buttons: [
          'Escolher uma pasta',
          'Escolher um arquivo .pkg',
          'Escolher arquivo compactado',
          'Cancelar'
        ],
        defaultId: 0,
        cancelId: 3,
        noLink: true
      })
      if (choice.response === 3) return null
      if (choice.response === 0) {
        const dir = await dialog.showOpenDialog(win!, {
          title: `Pasta do jogo ou dos arquivos .pkg — ${game.title}`,
          properties: ['openDirectory']
        })
        return dir.canceled || dir.filePaths.length === 0 ? null : dir.filePaths[0]
      }
      if (choice.response === 1) {
        const file = await dialog.showOpenDialog(win!, {
          title: `Arquivo .pkg — ${game.title}`,
          properties: ['openFile'],
          filters: [{ name: 'Pacote PlayStation (.pkg)', extensions: ['pkg'] }]
        })
        return file.canceled || file.filePaths.length === 0 ? null : file.filePaths[0]
      }
    }

    const rawExtensions = req
      ? req.extensions.map((ext) => ext.replace(/^\./, ''))
      : ['iso', 'z64', 'n64', 'v64', 'bin', 'cue', 'rom', 'xex', 'gcm', 'rvz']

    const archiveExtensions = ['zip', '7z', 'rar', 'gz', 'tgz', 'xz']
    const combinedExtensions = Array.from(
      new Set([...rawExtensions, ...archiveExtensions])
    )

    const result = await dialog.showOpenDialog(win!, {
      title: `Escolher ISO / ROM (ou arquivo .zip/.7z/.rar) para ${game.title}`,
      properties: ['openFile'],
      filters: [
        {
          name: 'ISO / ROM ou Compactado (.zip, .7z, .rar)',
          extensions: combinedExtensions
        },
        {
          name: 'Apenas Arquivos Compactados (.zip, .7z, .rar)',
          extensions: archiveExtensions
        },
        {
          name: req?.label || 'Apenas ISO / ROM Direta',
          extensions: rawExtensions
        },
        { name: 'Todos os arquivos', extensions: ['*'] }
      ]
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  }

  ipcMain.handle(
    'vault:pickFile',
    async (_e, gameId: string, requirementId?: string) => {
      const game = await findGameById(gameId)
      return openRomPickerDialog(game, requirementId)
    }
  )

  ipcMain.handle(
    'vault:pickPatches',
    async (_e, gameId: string, _requirementId: string | undefined, mode: 'files' | 'folder') => {
      const game = await findGameById(gameId)
      const win = getMainWindow()
      const result = await dialog.showOpenDialog(win!, {
        title:
          mode === 'folder'
            ? `Pasta de patch / DLC — ${game.title}`
            : `Patches, atualizações ou DLC — ${game.title}`,
        properties:
          mode === 'folder' ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections']
      })
      return result.canceled ? [] : result.filePaths
    }
  )

  ipcMain.handle(
    'vault:importRomManually',
    async (
      _e,
      gameId: string,
      requirementId?: string,
      prePickedPath?: string
    ) => {
      const game = await findGameById(gameId)
      const pickedPath =
        prePickedPath || (await openRomPickerDialog(game, requirementId))
      if (!pickedPath) {
        return null
      }

      // Runs as a tracked background task in DownloaderService so progress is visible in DOWNLOADS
      return downloader.startRomImport(game, pickedPath, requirementId)
    }
  )

  // Installation & Recipe Engine
  ipcMain.handle(
    'installer:install',
    async (
      _e,
      gameId: string,
      pickedRomPath?: string,
      requirementId?: string
    ) => {
      const game = await findGameById(gameId)
      return downloader.startInstall(game, pickedRomPath, requirementId)
    }
  )

  ipcMain.handle('installer:reapplyRecipe', async (_e, gameId: string) => {
    const installed = store.getInstalledGame(gameId)
    if (!installed) {
      throw new Error('Jogo não está instalado.')
    }
    const game = await findGameById(gameId)
    const availability = await romVault.checkRomAvailability(game)
    const recipeRes = await recipe.applyRecipe(
      game,
      installed.installDir,
      availability
    )

    const updated: InstalledGame = {
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
      recipeLogs: recipeRes.logs
    }
    store.upsertInstalledGame(updated)
    downloader.emitLibraryUpdated()
    return updated
  })

  ipcMain.handle(
    'installer:uninstall',
    async (_e, gameId: string, options?: UninstallGameOptions) => {
      await runner.stopGame(gameId)
      const installed = store.getInstalledGame(gameId)
      const settings = store.getSettings()

      // 0. Desfaz os atalhos para a pasta do jogo/patches ANTES de apagar a instalação:
      //    garante que o dump original do usuário (dezenas de GB) nunca seja tocado.
      if (installed) {
        for (const linkPath of [
          ...(installed.pairedRomPaths || []),
          ...(installed.pairedPatchPaths || []),
          ...(installed.aliasLinkPaths || [])
        ]) {
          try {
            if (fs.lstatSync(linkPath).isSymbolicLink()) fs.rmSync(linkPath, { force: true })
          } catch {
            // atalho já removido ou inexistente
          }
        }
      }

      // 1. Remove installed game directory
      if (installed && fs.existsSync(installed.installDir)) {
        try {
          fs.rmSync(installed.installDir, { recursive: true, force: true })
        } catch (err) {
          console.warn('[IPC] Failed to remove installDir:', err)
        }
      }

      // 2. Remove Linux Proton / Wine compatibility prefix for this game if present
      const compatPrefix = path.join(
        settings.installRootPath,
        '.compat_prefixes',
        gameId
      )
      if (fs.existsSync(compatPrefix)) {
        try {
          fs.rmSync(compatPrefix, { recursive: true, force: true })
        } catch {
          // Ignore
        }
      }

      // 3. Optionally remove the game's ISO / ROM files from the Vault and/or disk
      if (options?.deleteRomFromVault) {
        const currentVault = store.getRomVault()
        const safeGameFolder = gameId
          .replace(/[^a-zA-Z0-9_-]/g, '_')
          .slice(0, 56)
        const gameVaultDir = path.join(settings.romVaultPath, safeGameFolder)

        const remainingVault = currentVault.filter((entry) => {
          const isAssignedToGame =
            entry.assignedGameIds?.includes(gameId) ||
            entry.filePath.startsWith(gameVaultDir)

          if (!isAssignedToGame) return true

          // If user chose to delete the ISO/ROM from the computer (or if it lives inside RomVault), delete the file
          const isInsideRomVault = entry.filePath.startsWith(
            settings.romVaultPath
          )
          if (isInsideRomVault || (options?.deleteOriginalArchive && !entry.isDirectory)) {
            try {
              if (fs.existsSync(entry.filePath)) {
                // Pastas só são apagadas se foram extraídas para dentro do Cofre; uma pasta que o
                // usuário apontou (o dump dele) nunca é apagada, só esquecida.
                if (entry.isDirectory) fs.rmSync(entry.filePath, { recursive: true, force: true })
                else fs.unlinkSync(entry.filePath)
              }
            } catch (err) {
              console.warn('[IPC] Failed to delete ROM file:', err)
            }
          }

          return false
        })

        // Also remove the per-game RomVault directory if it exists
        if (fs.existsSync(gameVaultDir)) {
          try {
            fs.rmSync(gameVaultDir, { recursive: true, force: true })
          } catch {
            // Ignore
          }
        }

        store.setRomVault(remainingVault)
      }

      store.removeInstalledGame(gameId)
      downloader.emitLibraryUpdated()
    }
  )

  ipcMain.handle(
    'vault:removeEntry',
    async (_e, filePath: string, deleteFromDisk?: boolean) => {
      const currentVault = store.getRomVault()
      const removed = currentVault.find((e) => e.filePath === filePath)
      const remaining = currentVault.filter((e) => e.filePath !== filePath)
      const vaultRoot = path.resolve(store.getSettings().romVaultPath)
      const insideVault = path.resolve(filePath).startsWith(vaultRoot + path.sep)
      if (deleteFromDisk && filePath && fs.existsSync(filePath)) {
        try {
          if (removed?.isDirectory) {
            // Só apaga pastas extraídas para o Cofre; a pasta do usuário é apenas esquecida
            if (insideVault) fs.rmSync(filePath, { recursive: true, force: true })
          } else if (removed?.kind === 'patch' && !insideVault) {
            // Patches apontam para arquivos do usuário: nunca apagados, só removidos da lista
          } else {
            fs.unlinkSync(filePath)
          }
        } catch (err) {
          console.warn('[IPC] Failed to delete ROM file from disk:', err)
        }
      }
      store.setRomVault(remaining)
      return remaining
    }
  )

  ipcMain.handle(
    'library:setFullscreen',
    async (_e, gameId: string, fullscreen: boolean) => {
      const game = store.getInstalledGame(gameId)
      if (!game) return null
      const updated: InstalledGame = {
        ...game,
        launchFullscreen: fullscreen
      }
      store.upsertInstalledGame(updated)

      // Sync settings.json and user/tlg.ini if game is installed
      try {
        const displayModeStr = fullscreen ? 'Borderless' : 'Windowed'
        const iniDisplayMode = fullscreen ? 'borderless' : 'windowed'
        if (game.installDir && fs.existsSync(game.installDir)) {
          const tlgIniPaths = [
            path.join(game.installDir, 'user', 'tlg.ini'),
            path.join(game.installDir, 'tlg.ini')
          ]
          for (const iniPath of tlgIniPaths) {
            try {
              if (fs.existsSync(iniPath)) {
                let content = fs.readFileSync(iniPath, 'utf-8')
                if (/^display_mode\s*=/m.test(content)) {
                  content = content.replace(/^display_mode\s*=.*$/m, `display_mode=${iniDisplayMode}`)
                } else {
                  content = `${content.trim()}\ndisplay_mode=${iniDisplayMode}\n`
                }
                fs.writeFileSync(iniPath, content, 'utf-8')
              }
            } catch {}
          }

          const localSettings = path.join(game.installDir, 'user', 'settings.json')
          if (fs.existsSync(localSettings)) {
            try {
              const cur = JSON.parse(fs.readFileSync(localSettings, 'utf-8'))
              cur.display_mode = displayModeStr
              fs.writeFileSync(localSettings, JSON.stringify(cur, null, 2), 'utf-8')
            } catch {}
          }
        }
      } catch {}

      downloader.emitLibraryUpdated()
      return updated
    }
  )

  ipcMain.handle('installer:getActiveDownloads', async () => {
    return downloader.getActiveTasks()
  })

  ipcMain.handle('installer:cancelDownload', async (_e, taskId: string) => {
    return downloader.cancelInstall(taskId)
  })

  ipcMain.handle('installer:clearFinishedDownloads', async () => {
    return downloader.clearFinishedTasks()
  })

  ipcMain.handle('installer:clearDownloadTask', async (_e, taskId: string) => {
    return downloader.clearTask(taskId)
  })

  // Library & Runner
  ipcMain.handle('library:get', async () => {
    return store.getLibrary()
  })

  ipcMain.handle('library:launch', async (_e, gameId: string) => {
    return runner.launchGame(gameId)
  })

  ipcMain.handle('library:stop', async (_e, gameId: string) => {
    await runner.stopGame(gameId)
  })

  ipcMain.handle('library:openFolder', async (_e, gameId: string) => {
    const game = store.getInstalledGame(gameId)
    if (game && fs.existsSync(game.installDir)) {
      await shell.openPath(game.installDir)
    }
  })

  ipcMain.handle('library:selectExecutable', async (_e, gameId: string) => {
    const win = getMainWindow()
    const game = store.getInstalledGame(gameId)
    if (!game) return null

    const res = await dialog.showOpenDialog(win!, {
      title: `Selecionar executável para ${game.title}`,
      defaultPath: game.installDir,
      properties: ['openFile']
    })

    if (res.canceled || res.filePaths.length === 0) return null
    const execPath = res.filePaths[0]
    const isExe = execPath.toLowerCase().endsWith('.exe')

    const updated: InstalledGame = {
      ...game,
      executablePath: execPath,
      requiresCompatibilityLayer: process.platform === 'linux' && isExe
    }
    store.upsertInstalledGame(updated)
    downloader.emitLibraryUpdated()
    return updated
  })

  // Steam Integration
  ipcMain.handle('steam:addGame', async (_e, gameId: string) => {
    const installed = store.getInstalledGame(gameId)
    if (!installed) {
      throw new Error('O jogo precisa estar instalado para ser adicionado à Steam.')
    }
    let catalogGame: CatalogGame | undefined
    try {
      catalogGame = await findGameById(gameId)
    } catch {
      // Ignora erro ao buscar catálogo
    }
    return steam.addGameToSteam(installed, catalogGame)
  })

  ipcMain.handle('steam:removeGame', async (_e, gameId: string) => {
    return steam.removeGameFromSteam(gameId)
  })

  ipcMain.handle('steam:isGameAdded', async (_e, gameId: string) => {
    return steam.isGameInSteam(gameId)
  })

  // PKG Extractor que o usuário já tem instalado (o app não o inclui nem o baixa)
  const pkgExtractorStatus = async (): Promise<PkgExtractorStatus> => {
    const found = findExternalPkgExtractor(store.getSettings().pkgExtractorPath)
    if (!found) return { path: null, source: 'none', valid: false }
    const probe = await probePkgExtractor(found.path)
    return { path: found.path, source: found.source, valid: probe.ok, error: probe.error }
  }

  ipcMain.handle('pkg:extractorStatus', async () => pkgExtractorStatus())

  ipcMain.handle('pkg:pickExtractor', async () => {
    const win = getMainWindow()
    const res = await dialog.showOpenDialog(win!, {
      title: 'Escolher o PKG Extractor (pkg_extractor)',
      properties: ['openFile'],
      filters:
        process.platform === 'win32'
          ? [
              { name: 'PKG Extractor (pkg_extractor.exe)', extensions: ['exe'] },
              { name: 'Todos os arquivos', extensions: ['*'] }
            ]
          : [{ name: 'Todos os arquivos', extensions: ['*'] }]
    })
    if (!res.canceled && res.filePaths.length > 0) {
      store.updateSettings({ pkgExtractorPath: res.filePaths[0] })
    }
    return pkgExtractorStatus()
  })

  // Chaves para extrair PKG do PS4 (o app não inclui chaves: vêm do usuário)
  const pkgKeysStatus = (): PkgKeysStatus => {
    const configured = store.getSettings().pkgKeysPath
    const found = findPkgKeysFile(configured)
    if (!found) return { path: null, source: 'none', valid: false }
    const source: PkgKeysStatus['source'] =
      configured && path.resolve(configured) === path.resolve(found) ? 'config' : 'detected'
    try {
      loadPkgKeysFile(found)
      return { path: found, source, valid: true }
    } catch (err: any) {
      return { path: found, source, valid: false, error: err?.message || String(err) }
    }
  }

  ipcMain.handle('pkg:keysStatus', async () => pkgKeysStatus())

  ipcMain.handle('pkg:pickKeysFile', async () => {
    const win = getMainWindow()
    const res = await dialog.showOpenDialog(win!, {
      title: 'Escolher o arquivo de chaves (keys.json)',
      properties: ['openFile'],
      filters: [
        { name: 'Arquivo de chaves (JSON)', extensions: ['json'] },
        { name: 'Todos os arquivos', extensions: ['*'] }
      ]
    })
    if (!res.canceled && res.filePaths.length > 0) {
      store.updateSettings({ pkgKeysPath: res.filePaths[0] })
    }
    return pkgKeysStatus()
  })

  // Settings & System
  ipcMain.handle('settings:get', async () => {
    return store.getSettings()
  })

  ipcMain.handle('settings:update', async (_e, partial) => {
    return store.updateSettings(partial)
  })

  ipcMain.handle('system:selectDirectory', async (_e, title?: string) => {
    const win = getMainWindow()
    const res = await dialog.showOpenDialog(win!, {
      title: title || 'Selecionar Pasta',
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return res.filePaths[0]
  })

  ipcMain.handle(
    'system:selectFile',
    async (_e, title?: string, extensions?: string[]) => {
      const win = getMainWindow()
      const res = await dialog.showOpenDialog(win!, {
        title: title || 'Selecionar Arquivo',
        properties: ['openFile'],
        filters: extensions
          ? [{ name: 'Arquivos Permitidos', extensions }]
          : undefined
      })
      if (res.canceled || res.filePaths.length === 0) return null
      return res.filePaths[0]
    }
  )

  ipcMain.handle('system:detectLinuxRunners', async () => {
    return runner.detectLinuxRunners()
  })

  ipcMain.handle('system:openExternal', async (_e, url: string) => {
    if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
      await shell.openExternal(url)
    }
  })

  ipcMain.handle('system:getHostPlatform', async () => {
    return {
      platform: process.platform,
      arch: process.arch
    }
  })
}
