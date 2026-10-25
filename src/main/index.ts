import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { StoreService } from './services/store.service'
import { CatalogService } from './services/catalog.service'
import { RomVaultService } from './services/rom-vault.service'
import { RecipeService } from './services/recipe.service'
import { DownloaderService } from './services/downloader.service'
import { RunnerService } from './services/runner.service'
import { CommunityService } from './services/community.service'
import { registerIpcHandlers } from './ipc/handlers'

let mainWindow: BrowserWindow | null = null

// Diagnóstico de abertura: RECOMPHUB_TRACE=1 imprime o tempo (ms desde o início do processo) de cada etapa.
const TRACE_STARTUP = Boolean(process.env['RECOMPHUB_TRACE'])
function trace(label: string): void {
  if (TRACE_STARTUP) console.log(`[startup] ${label}: ${Math.round(performance.now())}ms`)
}
trace('main-module-loaded')

// Mantém a pasta de dados fixa em "recomphub" (ex.: ~/.config/recomphub, %APPDATA%\recomphub),
// independente do productName "RecompHUB", para não perder jogos/configurações já existentes.
app.setPath('userData', join(app.getPath('appData'), 'recomphub'))

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
    // No Windows empacotado o ícone já está embutido no .exe (evita decodificar o PNG grande na abertura)
    ...(process.platform === 'win32' && app.isPackaged ? {} : { icon: iconPath }),
    title: 'RecompHUB — 1-Click Decomp & Static Recomp PC Launcher (beta-0.1)',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      spellcheck: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    trace('window-ready-to-show')
    mainWindow?.show()
  })

  if (TRACE_STARTUP) {
    mainWindow.webContents.on('did-finish-load', () => trace('renderer-did-finish-load'))
    mainWindow.webContents.on('console-message', (_e, _level, message) => {
      const match = /^\[startup\] (.+?) epoch=(\d+)$/.exec(message)
      if (match) {
        const sinceStart = Number(match[2]) - performance.timeOrigin
        console.log(`[startup] renderer:${match[1]}: ${Math.round(sinceStart)}ms`)
      }
    })
  }

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
  trace('app-ready')
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
  const community = new CommunityService(store)

  trace('services-created')
  registerIpcHandlers(() => mainWindow, {
    store,
    catalog,
    romVault,
    recipe,
    downloader,
    runner,
    community
  })

  trace('ipc-registered')
  createWindow()
  trace('window-created')

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
