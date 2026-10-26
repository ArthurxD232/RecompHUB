import { build } from 'esbuild'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const work = mkdtempSync(join(tmpdir(), 'recomphub-steam-test-'))
const require = createRequire(import.meta.url)

async function bundle(entry, name) {
  const outfile = join(work, 'bundle', name.replace(/\.mjs$/, '.cjs'))
  await build({
    entryPoints: [join(root, entry)],
    outfile,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    logLevel: 'error',
    loader: { '.json': 'json' }
  })
  return require(outfile)
}

const {
  SteamService,
  parseBinaryVdf,
  writeBinaryVdf,
  computeSteamShortcutAppId
} = await bundle('src/main/services/steam.service.ts', 'steam.mjs')

console.log('Iniciando testes do SteamService...')

// 1. Teste de roundtrip do parser e serializer binário VDF
{
  const initialVdf = {
    shortcuts: {
      '0': {
        appid: -1526695126,
        AppName: 'Jogo Teste',
        Exe: '"/caminho/do/jogo"',
        StartDir: '"/caminho/do"',
        icon: '/caminho/icon.png',
        ShortcutPath: '',
        LaunchOptions: '',
        IsHidden: 0,
        AllowDesktopConfig: 1,
        AllowOverlay: 1,
        OpenVR: 0,
        Devkit: 0,
        DevkitGameID: 'jogo_teste__123',
        DevkitOverrideAppID: 0,
        LastPlayTime: 12345678,
        FlatpakAppID: '',
        sortas: '',
        tags: { '0': 'RecompHUB', '1': 'PS4' }
      }
    }
  }

  const encoded = writeBinaryVdf(initialVdf)
  assert.ok(encoded.length > 0)
  const decoded = parseBinaryVdf(encoded)
  assert.equal(decoded.shortcuts['0'].AppName, 'Jogo Teste')
  assert.equal(decoded.shortcuts['0'].appid, -1526695126)
  assert.equal(decoded.shortcuts['0'].DevkitGameID, 'jogo_teste__123')
  assert.equal(decoded.shortcuts['0'].tags['0'], 'RecompHUB')
  console.log('  ok   VDF: serialização e parsing binário preservam todos os campos')
}

// 2. Teste do cálculo de AppId Steam (CRC32 com bit 31 ligado)
{
  const exe = '"/usr/bin/mygame"'
  const name = 'My Super Game'
  const appId = computeSteamShortcutAppId(exe, name)
  assert.equal(typeof appId, 'number')
  assert.ok(appId < 0, 'AppID em shortcuts.vdf é um inteiro de 32 bits com sinal com o bit mais significativo setado')
  const unsigned = (appId >>> 0).toString()
  assert.ok(unsigned.length > 5)
  console.log('  ok   AppID: cálculo de CRC32 e identificador de Grid da Steam')
}

// 3. Teste de addGameToSteam e removeGameFromSteam com pasta Steam mockada
{
  const fakeHome = join(work, 'fakehome')
  const fakeUserdata = join(fakeHome, '.local', 'share', 'Steam', 'userdata', '12345678')
  const configDir = join(fakeUserdata, 'config')
  mkdirSync(configDir, { recursive: true })

  // Cria um shortcuts.vdf inicial com 1 jogo preexistente
  const initialData = {
    shortcuts: {
      '0': {
        appid: -100,
        AppName: 'Outro Jogo',
        Exe: '"/usr/bin/other"',
        StartDir: '"/usr/bin"',
        icon: '',
        ShortcutPath: '',
        LaunchOptions: '',
        IsHidden: 0,
        AllowDesktopConfig: 1,
        AllowOverlay: 1,
        OpenVR: 0,
        Devkit: 0,
        DevkitGameID: 'outro',
        DevkitOverrideAppID: 0,
        LastPlayTime: 0,
        FlatpakAppID: '',
        sortas: '',
        tags: {}
      }
    }
  }
  writeFileSync(join(configDir, 'shortcuts.vdf'), writeBinaryVdf(initialData))

  // Prepara o jogo simulado
  const gameDir = join(work, 'game_installed')
  mkdirSync(gameDir, { recursive: true })
  const fakeExec = join(gameDir, 'game_exec')
  writeFileSync(fakeExec, 'binary')

  const fakeIcon = join(gameDir, 'icon.png')
  writeFileSync(fakeIcon, 'PNG_DATA')

  const installedGame = {
    id: 'test_game__id',
    gameId: 'test_game__id',
    title: 'Meu Jogo Recomp',
    projectName: 'meu_jogo',
    repoFullName: 'author/meu_jogo',
    console: 'PlayStation 4',
    consoleBadge: 'PS4',
    version: '1.0',
    installDir: gameDir,
    executablePath: fakeExec,
    requiresCompatibilityLayer: false,
    status: 'READY_TO_PLAY',
    romPaired: true,
    pairedRomPaths: [],
    portableMode: true,
    playTimeSeconds: 0,
    installedAt: new Date().toISOString(),
    recipeLogs: []
  }

  const steam = new SteamService()
  // Mock getSteamUserDirs para usar nosso diretório de teste
  steam.getSteamUserDirs = () => [fakeUserdata]
  steam.isSteamRunning = () => false

  // Verifica se está na Steam (ainda não)
  assert.equal(await steam.isGameInSteam(installedGame.id), false)

  // Adiciona à Steam
  const addRes = await steam.addGameToSteam(installedGame)
  assert.equal(addRes.success, true)
  assert.equal(addRes.alreadyAdded, false)

  // Agora deve constar como adicionado
  assert.equal(await steam.isGameInSteam(installedGame.id), true)

  // Lê o shortcuts.vdf resultante
  const updatedVdf = parseBinaryVdf(readFileSync(join(configDir, 'shortcuts.vdf')))
  const entries = Object.values(updatedVdf.shortcuts)
  assert.equal(entries.length, 2, 'agora deve ter 2 jogos')
  const added = entries.find((e) => e.DevkitGameID === installedGame.id)
  assert.ok(added, 'o jogo deve estar no shortcuts.vdf')
  assert.equal(added.AppName, 'Meu Jogo Recomp')
  assert.equal(added.Exe, `"${fakeExec}"`)
  assert.equal(added.tags['0'], 'RecompHUB')
  assert.ok(!added.StartDir.startsWith('"'), 'StartDir não deve ter aspas literais')
  assert.ok(added.StartDir.endsWith('/') || added.StartDir.endsWith('\\'), 'StartDir deve terminar com barra')
  if (process.platform === 'linux') {
    assert.ok(added.LaunchOptions.includes('%command%'), 'No Linux deve sanitizar LD_LIBRARY_PATH da Steam')
  }

  // Verifica se as imagens do grid foram criadas
  const gridDir = join(configDir, 'grid')
  assert.ok(existsSync(gridDir))
  const unsignedId = (added.appid >>> 0).toString()
  assert.ok(existsSync(join(gridDir, `${unsignedId}_icon.png`)))

  // Remove da Steam
  const removeRes = await steam.removeGameFromSteam(installedGame.id)
  assert.equal(removeRes.success, true)
  assert.equal(await steam.isGameInSteam(installedGame.id), false)

  const finalVdf = parseBinaryVdf(readFileSync(join(configDir, 'shortcuts.vdf')))
  assert.equal(Object.keys(finalVdf.shortcuts).length, 1, 'voltou a ter só 1 jogo')
  assert.ok(!existsSync(join(gridDir, `${unsignedId}_icon.png`)), 'as imagens do grid foram limpas')

  console.log('  ok   SteamService: adição, persistência, geração de Grid e remoção funcionando perfeitamente')
}

// Limpeza
rmSync(work, { recursive: true, force: true })
console.log('Todos os testes do SteamService passaram com sucesso!')
