import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { StoreService } from './services/store.service'
import { CatalogService } from './services/catalog.service'
import { RomVaultService } from './services/rom-vault.service'
import { RecipeService } from './services/recipe.service'
import { DownloaderService } from './services/downloader.service'
import { RunnerService } from './services/runner.service'
import { registerIpcHandlers } from './ipc/handlers'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const iconPath = join(__dirname, '../../resources/icon.png')
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#171a21',
    icon: iconPath,
    title: 'RecompHUB — 1-Click Decomp & Static Recomp PC Launcher (beta-0.1)',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.recomphub.launcher')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const store = new StoreService()
  const catalog = new CatalogService(store)
  const romVault = new RomVaultService(store)
  const recipe = new RecipeService(store, romVault)
  const downloader = new DownloaderService(store, catalog, romVault, recipe)
  const runner = new RunnerService(store, downloader)

  registerIpcHandlers(() => mainWindow, {
    store,
    catalog,
    romVault,
    recipe,
    downloader,
    runner
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
