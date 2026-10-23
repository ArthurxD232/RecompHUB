import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { StoreService } from '../services/store.service'
import { CatalogService } from '../services/catalog.service'
import { RomVaultService } from '../services/rom-vault.service'
import { RecipeService } from '../services/recipe.service'
import { DownloaderService } from '../services/downloader.service'
import { RunnerService } from '../services/runner.service'
import {
  CatalogGame,
  InstalledGame,
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
  }
): void {
  const { store, catalog, romVault, recipe, downloader, runner } = services

  const findGameById = async (gameId: string): Promise<CatalogGame> => {
    const { games } = await catalog.getCatalog(false)
    const found = games.find((g) => g.id === gameId)
    if (!found) {
      throw new Error(`Jogo '${gameId}' não encontrado no catálogo.`)
    }
    return found
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

  // Catalog
  catalog.onUpdated((result) => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('event:catalogUpdated', result)
    }
  })

  ipcMain.handle('catalog:get', async (_e, forceRefresh?: boolean) => {
    return catalog.getCatalog(Boolean(forceRefresh))
  })

  ipcMain.handle('catalog:resolveRelease', async (_e, gameId: string) => {
    const game = await findGameById(gameId)
    return catalog.resolveRelease(game)
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
          if (isInsideRomVault || options?.deleteOriginalArchive) {
            try {
              if (fs.existsSync(entry.filePath)) {
                fs.unlinkSync(entry.filePath)
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
      const remaining = currentVault.filter((e) => e.filePath !== filePath)
      if (deleteFromDisk && filePath && fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath)
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
      downloader.emitLibraryUpdated()
      return updated
    }
  )

  ipcMain.handle('installer:getActiveDownloads', async () => {
    return downloader.getActiveTasks()
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
