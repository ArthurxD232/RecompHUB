// Teste do seletor de assets: node scripts/test-asset-selector.mjs
// Compila src/main/services/asset-selector.ts com o esbuild (já presente via Vite) e confere
// a escolha do binário para Windows e Linux em listas reais de releases do GitHub.
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = mkdtempSync(join(tmpdir(), 'recomphub-asset-test-'))
const outFile = join(outDir, 'asset-selector.mjs')

await build({
  entryPoints: [join(root, 'src/main/services/asset-selector.ts')],
  outfile: outFile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'error'
})

const { selectBestAsset } = await import(pathToFileURL(outFile).href)
rmSync(outDir, { recursive: true, force: true })

const assets = (...names) => names.map((name) => ({ name, browserDownloadUrl: `https://x/${name}`, size: 1, contentType: '' }))
const win = { platform: 'win32', arch: 'x64', preferNativeLinux: true }
const linux = { platform: 'linux', arch: 'x64', preferNativeLinux: true }
const linuxProton = { platform: 'linux', arch: 'x64', preferNativeLinux: false }

const cases = [
  {
    name: 'Sonic CD (RSDKv3): ZIP de macOS não pode ser tratado como Windows',
    assets: assets('v3-android.zip', 'v3-linux.zip', 'v3-mac.zip', 'v3-windows-x64.zip', 'v3-windows.zip'),
    expect: { win: 'v3-windows-x64.zip', linux: 'v3-linux.zip', proton: 'v3-windows-x64.zip' }
  },
  {
    name: 'Metroid Prime Port: AppImage no Linux, zip x86_64 no Windows (sem ARM/PDB/APK)',
    assets: assets(
      'metroid-prime-port-0.32.0-android-arm64.apk',
      'metroid-prime-port-0.32.0-linux-aarch64.tar.gz',
      'metroid-prime-port-0.32.0-linux-x86_64.tar.gz',
      'metroid-prime-port-0.32.0-macos-arm64.zip',
      'metroid-prime-port-0.32.0-windows-arm64.zip',
      'metroid-prime-port-0.32.0-windows-x86_64.zip',
      'MetroidPrime-aarch64.AppImage',
      'MetroidPrime-x86_64.AppImage',
      'MetroidPrimePort.flatpak'
    ),
    expect: {
      win: 'metroid-prime-port-0.32.0-windows-x86_64.zip',
      linux: 'MetroidPrime-x86_64.AppImage',
      proton: 'metroid-prime-port-0.32.0-windows-x86_64.zip'
    }
  },
  {
    name: 'Conker Reloaded: ignora texturas .rtz',
    assets: assets(
      'ConkerBFDReloaded-HD-Icons-French-v1.3.5.rtz',
      'ConkerBFDReloaded-HD-Icons-v1.3.3.rtz',
      'ConkerBFDReloaded-v1.4.6-Linux.tar.gz',
      'ConkerBFDReloaded-v1.4.6-Windows.zip'
    ),
    expect: { win: 'ConkerBFDReloaded-v1.4.6-Windows.zip', linux: 'ConkerBFDReloaded-v1.4.6-Linux.tar.gz', proton: 'ConkerBFDReloaded-v1.4.6-Windows.zip' }
  },
  {
    name: 'Body Harvest: ignora debug-symbols',
    assets: assets(
      'body-harvest-recomp-0.1.0-linux-x86_64-debug-symbols.tar.gz',
      'body-harvest-recomp-0.1.0-linux-x86_64.tar.gz',
      'body-harvest-recomp-0.1.0-windows-x64-debug-symbols.zip',
      'body-harvest-recomp-0.1.0-windows-x64.zip'
    ),
    expect: { win: 'body-harvest-recomp-0.1.0-windows-x64.zip', linux: 'body-harvest-recomp-0.1.0-linux-x86_64.tar.gz', proton: 'body-harvest-recomp-0.1.0-windows-x64.zip' }
  },
  {
    name: 'BattleTanx: só Windows -> Proton no Linux',
    assets: assets('BattleTanxGA-0.2.5-windows-x64-portable.zip'),
    expect: { win: 'BattleTanxGA-0.2.5-windows-x64-portable.zip', linux: 'BattleTanxGA-0.2.5-windows-x64-portable.zip', proton: 'BattleTanxGA-0.2.5-windows-x64-portable.zip' },
    linuxNeedsCompat: true
  },
  {
    name: 'Release só com assets inúteis',
    assets: assets('SHA256SUMS.txt', 'app-source.tar.gz', 'app.apk'),
    expect: { win: null, linux: null, proton: null }
  },
  {
    name: 'FFTARecomp: instalador/ARM/Android',
    assets: assets('FFTARecomp-android-arm64.apk', 'FFTARecomp-linux-x86_64.tar.gz', 'FFTARecomp-SteamDeck-linux-x86_64.tar.gz', 'FFTARecomp-windows-x86_64.zip'),
    expect: { win: 'FFTARecomp-windows-x86_64.zip', linux: 'FFTARecomp-linux-x86_64.tar.gz', proton: 'FFTARecomp-windows-x86_64.zip' }
  },
  {
    name: 'Zip genérico sem sistema no nome é aceito no Windows; tar.gz genérico vira Linux',
    assets: assets('game-1.0.zip', 'game-1.0.tar.gz'),
    expect: { win: 'game-1.0.zip', linux: 'game-1.0.tar.gz', proton: 'game-1.0.zip' }
  },
  {
    name: 'Release só com build Linux: no Windows não instala o arquivo errado',
    assets: assets('AlienResurrectionRecompilation-v0.3.0-linux-x64.zip', 'AlienResurrectionRecompilation-v0.3.0-x86_64.AppImage'),
    expect: { win: null, linux: 'AlienResurrectionRecompilation-v0.3.0-x86_64.AppImage', proton: 'AlienResurrectionRecompilation-v0.3.0-x86_64.AppImage' }
  },
  {
    name: 'Release só com build macOS: nada para Windows nem Linux',
    assets: assets('GoldenEye64Recomp-V1.0.0-macOS-arm64.zip'),
    expect: { win: null, linux: null, proton: null }
  },
  {
    name: 'Pacotes de licença/avisos/atualização não são o jogo',
    assets: assets('KartPad-v0.8.5-notices.zip', 'FateUnlimitedCodesRecomp-update.zip', 'update-manifest.json'),
    expect: { win: null, linux: null, proton: null }
  },
  {
    name: 'Infinite Undiscovery: ignora o zip de conformidade LGPL',
    assets: assets('InfiniteUndiscoveryRecomp-v1.0.0-rc1-LGPL-Compliance.zip', 'InfiniteUndiscoveryRecomp-v1.0.0-rc1.zip'),
    expect: { win: 'InfiniteUndiscoveryRecomp-v1.0.0-rc1.zip' }
  },
  {
    name: 'OpenGOAL Launcher: .msi/.deb/.app não servem; AppImage no Linux; nada no Windows',
    assets: assets(
      'OpenGOAL-Launcher_2.11.2_amd64.AppImage',
      'OpenGOAL-Launcher_2.11.2_amd64.AppImage.tar.gz',
      'OpenGOAL-Launcher_2.11.2_amd64.deb',
      'OpenGOAL-Launcher_2.11.2_x64.app.tar.gz',
      'OpenGOAL-Launcher_2.11.2_x64_en-US.msi',
      'OpenGOAL-Launcher_2.11.2_x64_en-US.msi.zip'
    ),
    expect: { win: null, linux: 'OpenGOAL-Launcher_2.11.2_amd64.AppImage', proton: 'OpenGOAL-Launcher_2.11.2_amd64.AppImage' }
  },
  {
    name: 'PaperBoat: "Delta" é codinome da versão, não um pacote de atualização',
    assets: assets('Paperboat-Mulberry-Delta-Linux.zip', 'Paperboat-Mulberry-Delta-Mac.zip', 'Paperboat-Mulberry-Delta-Win64.zip'),
    expect: { win: 'Paperboat-Mulberry-Delta-Win64.zip', linux: 'Paperboat-Mulberry-Delta-Linux.zip' }
  },
  {
    name: 'Versão com "32" no nome não é confundida com build 32 bits',
    assets: assets('game-0.32.0-linux.tar.gz', 'game-0.32.0-linux-x86_64.tar.gz'),
    expect: { linux: 'game-0.32.0-linux-x86_64.tar.gz' }
  },
  {
    name: 'Zelda64Recomp: ignora Flatpak (mesmo em .zip) e escolhe Linux-X64 standalone',
    assets: assets(
      'Zelda64Recompiled-v1.2.2-Linux-ARM64.zip',
      'Zelda64Recompiled-v1.2.2-Linux-Flatpak-X64.zip',
      'Zelda64Recompiled-v1.2.2-Linux-X64.zip',
      'Zelda64Recompiled-v1.2.2-macOS.zip',
      'Zelda64Recompiled-v1.2.2-Windows.zip'
    ),
    expect: {
      win: 'Zelda64Recompiled-v1.2.2-Windows.zip',
      linux: 'Zelda64Recompiled-v1.2.2-Linux-X64.zip',
      proton: 'Zelda64Recompiled-v1.2.2-Windows.zip'
    }
  }
]

let failures = 0
for (const c of cases) {
  const results = {
    win: selectBestAsset(c.assets, win).asset?.name ?? null,
    linux: selectBestAsset(c.assets, linux).asset?.name ?? null,
    proton: selectBestAsset(c.assets, linuxProton).asset?.name ?? null
  }
  try {
    // Só confere as chaves declaradas em `expect` (alguns casos não têm build para todos os sistemas)
    for (const [key, value] of Object.entries(c.expect)) {
      assert.equal(results[key], value, key)
    }
    if (c.linuxNeedsCompat) {
      assert.equal(selectBestAsset(c.assets, linux).requiresCompatibilityLayer, true)
    }
    console.log(`  ok   ${c.name}`)
  } catch (err) {
    failures++
    console.log(`  FAIL ${c.name}\n       esperado ${JSON.stringify(c.expect)}\n       obtido   ${JSON.stringify(results)}`)
  }
}

if (failures > 0) {
  console.error(`\n${failures} caso(s) falharam`)
  process.exit(1)
}
console.log(`\n${cases.length} casos OK`)
