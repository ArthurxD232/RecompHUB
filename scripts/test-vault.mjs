// Teste do cofre/receitas com arquivos grandes, pastas e patches: node scripts/test-vault.mjs [--big]
//   --big  também cria e extrai um .zip de ~2,3 GB (o limite de 2 GiB do Node derrubava o AdmZip).
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, lstatSync, readdirSync, readFileSync, statSync, readlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, delimiter } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import { buildPkg, keysJson, makeKeyset } from './lib/synthetic-pkg.mjs'
import { writeFakeExtractor } from './lib/fake-extractor.mjs'

const BIG = process.argv.includes('--big')
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const work = mkdtempSync(join(tmpdir(), 'recomphub-vault-test-'))

const require = createRequire(import.meta.url)
async function bundle(entry, name) {
  // CJS: as dependências (tar, node-stream-zip) usam require() de módulos nativos do Node
  const outfile = join(work, 'bundle', name.replace(/\.mjs$/, '.cjs'))
  await build({ entryPoints: [join(root, entry)], outfile, bundle: true, format: 'cjs', platform: 'node', logLevel: 'error', loader: { '.json': 'json' } })
  return require(outfile)
}

const { RomVaultService } = await bundle('src/main/services/rom-vault.service.ts', 'rom-vault.mjs')
const { RecipeService } = await bundle('src/main/services/recipe.service.ts', 'recipe.mjs')
const { CatalogService } = await bundle('src/main/services/catalog.service.ts', 'catalog.mjs')
const { extractZipStreaming } = await bundle('src/main/services/archive.service.ts', 'archive.mjs')

// Isola o teste: nenhum keys.json real da máquina (shadPS4) pode ser encontrado
process.env.HOME = join(work, 'home')
process.env.APPDATA = join(work, 'appdata')
process.env.LOCALAPPDATA = join(work, 'localappdata')
delete process.env.RECOMPHUB_PKG_KEYS
delete process.env.RECOMPHUB_PKG_EXTRACTOR
// ...nem um pkg_extractor de verdade instalado no PATH
process.env.PATH = (process.env.PATH || '')
  .split(delimiter)
  .filter((d) => !existsSync(join(d, 'pkg_extractor')) && !existsSync(join(d, 'pkg_extractor.AppImage')))
  .join(delimiter)

const vaultDir = join(work, 'vault')
const installRoot = join(work, 'games')
mkdirSync(vaultDir, { recursive: true })
mkdirSync(installRoot, { recursive: true })

// Store falso, com o mesmo comportamento de mesclagem do real
const settings = {
  romVaultPath: vaultDir,
  installRootPath: installRoot,
  linkStrategy: 'symlink',
  pkgKeysPath: '',
  pkgExtractorPath: '',
  createPortableTxtByDefault: false,
  extractXisoPath: 'extract-xiso'
}
let vault = []
const store = {
  getSettings: () => settings,
  getRomVault: () => vault,
  setRomVault: (e) => { vault = e },
  upsertRomVaultEntry: (entry) => {
    const i = vault.findIndex((e) => e.filePath === entry.filePath || (entry.sha1 && e.sha1 === entry.sha1))
    if (i >= 0) {
      const prev = vault[i]
      vault[i] = { ...prev, ...entry,
        assignedGameIds: [...new Set([...(prev.assignedGameIds || []), ...(entry.assignedGameIds || [])])],
        assignedRequirementIds: [...new Set([...(prev.assignedRequirementIds || []), ...(entry.assignedRequirementIds || [])])] }
    } else vault.push(entry)
  }
}

const catalog = new CatalogService(store)
const romVault = new RomVaultService(store)
const recipeSvc = new RecipeService(store, romVault)

const ps4Game = (() => {
  const base = { id: 'bloodborne_pc__test', title: 'Bloodborne', projectName: 'bloodborne_pc', repoFullName: 'Supermedo/bloodborne_pc',
    githubUrl: '', console: 'PlayStation 4', consoleBadge: 'PS4', version: '1', releaseStatus: 'Latest', isAiAssisted: false,
    platforms: ['Windows'], updatedAt: new Date().toISOString(), inferredFamily: 'GenericNative' }
  return { ...base, recipe: catalog.findRecipeForRepo(base.repoFullName) }
})()
const heuristicPs4 = (() => {
  const g = { id: 'ps4_generic', title: 'Jogo PS4', projectName: 'ps4port', repoFullName: 'x/ps4port', githubUrl: '', console: 'PlayStation 4',
    consoleBadge: 'PS4', version: '1', releaseStatus: 'Latest', isAiAssisted: false, platforms: ['Windows'], updatedAt: '', inferredFamily: 'GenericNative' }
  return { ...g, recipe: catalog.buildHeuristicRecipe(g) }
})()

const results = []
async function test(name, fn) {
  try { await fn(); results.push([true, name]); console.log(`  ok   ${name}`) }
  catch (err) { results.push([false, name]); console.log(`  FAIL ${name}\n       ${err.stack?.split('\n').slice(0, 4).join('\n       ')}`) }
}

const py = (code) => execFileSync('python3', ['-I', '-c', code], { stdio: ['ignore', 'pipe', 'inherit'] })

// ---------------------------------------------------------------- ZIP
const smallZip = join(work, 'dump.zip')
py(`
import zipfile
with zipfile.ZipFile(${JSON.stringify(smallZip)}, 'w') as z:
    z.writestr('CUSA03173/eboot.bin', b'ELF'*100)
    z.writestr('CUSA03173\\\\sce_sys\\\\param.sfo', b'sfo')   # separador do Windows
    z.writestr('CUSA03173/image0/data.pak', b'0'*5000)
    info = zipfile.ZipInfo('CUSA03173/run.sh'); info.external_attr = 0o755 << 16
    z.writestr(info, '#!/bin/sh\\n')
    z.writestr('../escapou.txt', b'x')                          # tentativa de zip slip
`)

await test('zip: extração em fluxo preserva estrutura, separador "\\" e bit de execução; ignora zip slip', async () => {
  const out = join(work, 'out-small')
  const progress = []
  const res = await extractZipStreaming(smallZip, out, { onProgress: (p) => progress.push(p.percent) })
  assert.ok(existsSync(join(out, 'CUSA03173', 'eboot.bin')))
  assert.ok(existsSync(join(out, 'CUSA03173', 'sce_sys', 'param.sfo')))
  assert.ok(!existsSync(join(work, 'escapou.txt')), 'zip slip deve ser bloqueado')
  assert.equal(progress.at(-1), 100)
  if (process.platform !== 'win32') assert.ok((statSync(join(out, 'CUSA03173', 'run.sh')).mode & 0o111) !== 0, 'bit de execução')
  assert.equal(res.fileCount, 4)
})

if (BIG) {
  const bigZip = join(work, 'big.zip')
  await test('zip > 2 GiB (zip64): extrai sem o erro "File size is greater than 2 GiB"', async () => {
    py(`
import zipfile
chunk = b'\\0' * (16 * 1024 * 1024)
with zipfile.ZipFile(${JSON.stringify(bigZip)}, 'w', zipfile.ZIP_STORED, allowZip64=True) as z:
    z.writestr('GAME/eboot.bin', b'ELF')
    with z.open('GAME/data.pak', 'w', force_zip64=True) as f:
        for _ in range(150):   # 150 x 16 MiB = 2,3 GiB
            f.write(chunk)
`)
    assert.ok(statSync(bigZip).size > 2 * 1024 ** 3, 'o zip de teste precisa passar de 2 GiB')
    const out = join(work, 'out-big')
    const t0 = Date.now()
    const res = await extractZipStreaming(bigZip, out)
    assert.equal(statSync(join(out, 'GAME', 'data.pak')).size, 150 * 16 * 1024 * 1024)
    console.log(`       ${(res.totalBytes / 1024 ** 3).toFixed(2)} GiB extraídos em ${((Date.now() - t0) / 1000).toFixed(1)}s`)
    rmSync(out, { recursive: true, force: true })
  })
}

// ---------------------------------------------------------------- COFRE
await test('PS4: o requisito padrão é uma pasta (não uma ISO)', async () => {
  const req = heuristicPs4.recipe.requirements[0]
  assert.equal(req.type, 'folder')
  assert.equal(ps4Game.recipe.requirements[0].type, 'folder')
})

await test('cofre: dump em .zip vira UMA pasta (raiz achatada), não um arquivo aleatório', async () => {
  const steps = []
  const entry = await romVault.importRomOrArchiveForGame(smallZip, ps4Game, 'bloodborne_dump', (p, l) => steps.push([p, l]))
  assert.equal(entry.isDirectory, true)
  assert.equal(entry.fileName, 'CUSA03173')
  assert.ok(existsSync(join(entry.filePath, 'eboot.bin')))
  assert.ok(steps.some(([, label]) => /Extraindo/.test(label)))
  const status = await romVault.checkRomAvailability(ps4Game)
  assert.equal(status.ready, true)
})

const playerDump = join(work, 'meu-dump-ps4')
mkdirSync(join(playerDump, 'sce_sys'), { recursive: true })
writeFileSync(join(playerDump, 'eboot.bin'), 'ELF')
writeFileSync(join(playerDump, 'sce_sys', 'param.sfo'), 'sfo')

await test('cofre: pasta escolhida pelo usuário é registrada por referência (nada é copiado)', async () => {
  const before = readdirSync(vaultDir).length
  const entry = await romVault.importRomOrArchiveForGame(playerDump, heuristicPs4, undefined)
  assert.equal(entry.filePath, playerDump)
  assert.equal(entry.isDirectory, true)
  assert.equal(readdirSync(vaultDir).length, before, 'o cofre não pode crescer')
  assert.equal((await romVault.checkRomAvailability(heuristicPs4)).ready, true)
})

const patchFile = join(work, 'update-1.09.pkg')
writeFileSync(patchFile, Buffer.alloc(2048, 7))
const dlcDir = join(work, 'SPEXPANSIONDLC03')
mkdirSync(join(dlcDir, 'sce_sys'), { recursive: true })
writeFileSync(join(dlcDir, 'sce_sys', 'param.sfo'), 'dlc')

const freshGame = { ...heuristicPs4, id: 'ps4_fresh', recipe: { ...heuristicPs4.recipe, id: 'fresh' } }
await test('patches: arquivo e pasta ficam no cofre e NÃO contam como o jogo principal', async () => {
  const before = await romVault.checkRomAvailability(freshGame)
  assert.equal(before.ready, false)
  await romVault.importRomOrArchiveForGame(patchFile, freshGame, 'patches')
  await romVault.importRomOrArchiveForGame(dlcDir, freshGame, 'patches')
  const after = await romVault.checkRomAvailability(freshGame)
  const main = after.matchedRequirements.find((m) => m.requirement.type === 'folder')
  const patches = after.matchedRequirements.find((m) => m.requirement.type === 'patch')
  assert.equal(main.status, 'missing', 'patch não pode satisfazer o requisito principal')
  assert.equal(after.ready, false)
  assert.equal(patches.localEntries.length, 2)
  assert.equal(patches.requirement.optional, true)
})

await test('receita: vincula a pasta do jogo e os patches na pasta de instalação, sem copiar', async () => {
  await romVault.importRomOrArchiveForGame(playerDump, freshGame, undefined)
  const installDir = join(installRoot, 'fresh')
  mkdirSync(installDir, { recursive: true })
  writeFileSync(join(installDir, 'Bloodborne.exe'), 'MZ')
  const availability = await romVault.checkRomAvailability(freshGame)
  const res = await recipeSvc.applyRecipe(freshGame, installDir, availability)
  assert.equal(res.status, 'READY_TO_PLAY')
  const link = join(installDir, 'game_dump')
  assert.ok(lstatSync(link).isSymbolicLink(), 'game_dump deve ser atalho')
  assert.equal(readlinkSync(link), playerDump)
  assert.ok(lstatSync(join(installDir, 'patches', 'update-1.09.pkg')).isSymbolicLink())
  assert.ok(lstatSync(join(installDir, 'patches', 'SPEXPANSIONDLC03')).isSymbolicLink())
  assert.equal(res.pairedPatchPaths.length, 2)
  // apagar a instalação (como a desinstalação faz) não pode tocar no dump original
  for (const p of [...res.pairedRomPaths, ...res.pairedPatchPaths]) if (lstatSync(p).isSymbolicLink()) rmSync(p, { force: true })
  rmSync(installDir, { recursive: true, force: true })
  assert.ok(existsSync(join(playerDump, 'eboot.bin')), 'o dump do usuário deve continuar intacto')
  assert.ok(existsSync(patchFile))
})

await test('bloodborne: atalho CUSA03173 ao lado da pasta do port (onde o launcher procura o jogo)', async () => {
  const installDir = join(installRoot, 'bloodborne_pc_test')
  mkdirSync(installDir, { recursive: true })
  writeFileSync(join(installDir, 'Bloodborne.exe'), 'MZ')
  await romVault.importRomOrArchiveForGame(playerDump, ps4Game, 'bloodborne_dump')
  const availability = await romVault.checkRomAvailability(ps4Game)
  const res = await recipeSvc.applyRecipe(ps4Game, installDir, availability)
  const alias = join(installRoot, 'CUSA03173')
  assert.ok(lstatSync(alias).isSymbolicLink())
  assert.equal(readlinkSync(alias), playerDump)
  assert.deepEqual(res.aliasLinkPaths, [alias])
  assert.ok(existsSync(join(alias, 'eboot.bin')), 'o launcher enxerga o eboot.bin pelo caminho padrão')
  rmSync(alias, { force: true })
  rmSync(installDir, { recursive: true, force: true })
  assert.ok(existsSync(join(playerDump, 'eboot.bin')))
})

await test('receita: atalho que tentaria sair da pasta de jogos é recusado', async () => {
  const evil = { ...ps4Game, id: 'evil', recipe: { ...ps4Game.recipe, aliasLinks: [{ requirementId: 'bloodborne_dump', path: '../../escapou' }] } }
  const installDir = join(installRoot, 'evil')
  mkdirSync(installDir, { recursive: true })
  await romVault.importRomOrArchiveForGame(playerDump, evil, 'bloodborne_dump')
  const res = await recipeSvc.applyRecipe(evil, installDir, await romVault.checkRomAvailability(evil))
  assert.equal(res.aliasLinkPaths.length, 0)
  assert.ok(!existsSync(join(work, 'escapou')))
})

await test('pasta do jogo: escolher a pasta "de cima" desce até a que tem o eboot.bin; sem eboot.bin dá erro claro', async () => {
  const parent = join(work, 'Dumps')
  mkdirSync(join(parent, 'CUSA03173', 'sce_sys'), { recursive: true })
  writeFileSync(join(parent, 'CUSA03173', 'eboot.bin'), 'ELF')
  writeFileSync(join(parent, 'CUSA03173', 'sce_sys', 'param.sfo'), 'x')
  const g = { ...ps4Game, id: 'marker_game' }
  const entry = await romVault.importRomOrArchiveForGame(parent, g, 'bloodborne_dump')
  assert.equal(entry.filePath, join(parent, 'CUSA03173'))

  const wrong = join(work, 'NaoEhJogo')
  mkdirSync(wrong, { recursive: true })
  writeFileSync(join(wrong, 'qualquer.txt'), 'x')
  await assert.rejects(
    () => romVault.importRomOrArchiveForGame(wrong, { ...ps4Game, id: 'marker_bad' }, 'bloodborne_dump'),
    /eboot\.bin/
  )
})

// Estrutura real de uma "scene release" de PS4: só pacotes .pkg + .nfo, nenhum eboot.bin
const pkgZip = join(work, 'scene-release.zip')
py(`
import zipfile
with zipfile.ZipFile(${JSON.stringify(pkgZip)}, 'w') as z:
    z.writestr('Bloodborne.v1.09.PS4-CUSA00900/Bloodborne.v1.09.PS4-CUSA00900.pkg', b'PKG'*1000)
    z.writestr('Bloodborne.v1.09.PS4-CUSA00900/b-00900.nfo', b'nfo')
    z.writestr('Bloodborne.v1.09.PS4-CUSA00900/DLC/dlc.pkg', b'PKG')
`)

await test('PKG do PlayStation num zip, sem chaves: recusado ANTES de extrair, explicando o que fazer', async () => {
  const g = { ...ps4Game, id: 'pkg_game' }
  const before = existsSync(join(vaultDir, 'pkg_game'))
  await assert.rejects(
    () => romVault.importRomOrArchiveForGame(pkgZip, g, 'bloodborne_dump'),
    (err) => /pacotes \.pkg/.test(err.message) && /chaves/i.test(err.message) && /extraia/i.test(err.message)
  )
  assert.equal(existsSync(join(vaultDir, 'pkg_game')), before, 'nada pode ter sido extraído')
})

await test('PKG do PlayStation: pasta com .pkg também é recusada com a mesma explicação', async () => {
  const dir = join(work, 'pasta-so-com-pkg')
  mkdirSync(join(dir, 'DLC'), { recursive: true })
  writeFileSync(join(dir, 'jogo.pkg'), 'PKG')
  await assert.rejects(
    () => romVault.importRomOrArchiveForGame(dir, { ...ps4Game, id: 'pkg_dir' }, 'bloodborne_dump'),
    /pacotes \.pkg/
  )
})

await test('item antigo sem eboot.bin: vira "pendente" com o problema explicado e os atalhos velhos saem', async () => {
  const g = { ...ps4Game, id: 'stale_game' }
  const stale = join(work, 'registrado-antes-da-conferencia')
  mkdirSync(stale, { recursive: true })
  writeFileSync(join(stale, 'x.pkg'), 'PKG')
  // simula o que versões antigas faziam: registrar a pasta sem conferir
  store.upsertRomVaultEntry({ filePath: stale, fileName: 'registrado-antes-da-conferencia', size: 3, sha1: 'stale-sha', md5: 'stale-md5',
    extension: '', scannedAt: new Date().toISOString(), assignedGameIds: [g.id], assignedRequirementIds: [`${g.id}::bloodborne_dump`], isDirectory: true, kind: 'main' })
  const installDir = join(installRoot, 'stale_install')
  mkdirSync(installDir, { recursive: true })
  writeFileSync(join(installDir, 'Bloodborne.exe'), 'MZ')
  // atalhos que uma versão antiga já tinha criado
  const { symlinkSync } = await import('node:fs')
  symlinkSync(stale, join(installDir, 'game_dump'), 'dir')
  symlinkSync(stale, join(installRoot, 'CUSA03173'), 'dir')

  const availability = await romVault.checkRomAvailability(g)
  const main = availability.matchedRequirements.find((m) => m.requirement.id === 'bloodborne_dump')
  assert.equal(main.status, 'missing')
  assert.match(main.problem, /pacotes \.pkg/)
  assert.equal(availability.ready, false)

  const res = await recipeSvc.applyRecipe(g, installDir, availability)
  assert.equal(res.status, 'NEEDS_ROM')
  assert.ok(!existsSync(join(installDir, 'game_dump')) && !lstatExists(join(installDir, 'game_dump')), 'atalho game_dump velho removido')
  assert.ok(!lstatExists(join(installRoot, 'CUSA03173')), 'atalho CUSA03173 velho removido')
  assert.ok(res.logs.some((l) => /Problema:/.test(l)))
  rmSync(stale, { recursive: true, force: true })
})

function lstatExists(p) { try { lstatSync(p); return true } catch { return false } }

await test('item registrado na pasta "de cima": a receita acha a raiz certa (com o eboot.bin) e aponta para ela', async () => {
  const g = { ...ps4Game, id: 'parent_game' }
  const parent = join(work, 'pai-do-dump')
  mkdirSync(join(parent, 'CUSA03173'), { recursive: true })
  writeFileSync(join(parent, 'CUSA03173', 'eboot.bin'), 'ELF')
  writeFileSync(join(parent, 'leia-me.nfo'), 'x')
  store.upsertRomVaultEntry({ filePath: parent, fileName: 'pai-do-dump', size: 4, sha1: 'parent-sha', md5: 'parent-md5',
    extension: '', scannedAt: new Date().toISOString(), assignedGameIds: [g.id], assignedRequirementIds: [`${g.id}::bloodborne_dump`], isDirectory: true, kind: 'main' })
  const installDir = join(installRoot, 'parent_install')
  mkdirSync(installDir, { recursive: true })
  writeFileSync(join(installDir, 'Bloodborne.exe'), 'MZ')
  const res = await recipeSvc.applyRecipe(g, installDir, await romVault.checkRomAvailability(g))
  assert.equal(res.status, 'READY_TO_PLAY')
  assert.equal(readlinkSync(join(installDir, 'game_dump')), join(parent, 'CUSA03173'))
  assert.equal(readlinkSync(join(installRoot, 'CUSA03173')), join(parent, 'CUSA03173'))
  assert.ok(existsSync(join(installRoot, 'CUSA03173', 'eboot.bin')))
  rmSync(join(installRoot, 'CUSA03173'), { force: true })
})

// ---------------------------------------------------------------- PKG do PS4 (extração automática)
const pkgGameFiles = [
  { path: 'eboot.bin', data: Buffer.from('eboot 1.00'.repeat(50)) },
  { path: 'sce_sys/param.sfo', data: Buffer.from('sfo') },
  { path: 'dvdroot_ps4/dados.bin', data: Buffer.alloc(200_000, 7) }
]
const pkgDir = join(work, 'scene-release')
mkdirSync(pkgDir, { recursive: true })
writeFileSync(join(pkgDir, 'Jogo.v1.00.PS4-CUSA99999.pkg'), buildPkg({ files: pkgGameFiles, category: 'gd', appVer: '01.00' }))
writeFileSync(join(pkgDir, 'Jogo.v1.09.PATCH.PS4-CUSA99999.pkg'), buildPkg({ files: [{ path: 'eboot.bin', data: Buffer.from('eboot 1.09 corrigido') }], category: 'gp', appVer: '01.09' }))
writeFileSync(join(pkgDir, 'DLC01.pkg'), buildPkg({ files: [{ path: 'sce_sys/param.sfo', data: Buffer.from('dlc') }], category: 'ac', contentType: 0x1b, contentId: 'UP9000-CUSA99999_00-DLC0100000000000' }))
writeFileSync(join(pkgDir, 'b-99999.nfo'), 'nfo')
// variantes de MOD (excludentes) ficam numa subpasta, como nos lançamentos reais
mkdirSync(join(pkgDir, 'MODs'), { recursive: true })
writeFileSync(join(pkgDir, 'MODs', 'Jogo.v1.09.60fps.MOD.PS4-CUSA99999.pkg'), buildPkg({ files: [{ path: 'eboot.bin', data: Buffer.from('eboot MOD 60fps') }], category: 'gp', appVer: '01.09' }))
writeFileSync(join(pkgDir, 'MODs', 'Jogo.v1.09.30fps.MOD.PS4-CUSA99999.pkg'), buildPkg({ files: [{ path: 'eboot.bin', data: Buffer.from('eboot MOD 30fps') }], category: 'gp', appVer: '01.09' }))

const keysFile = join(work, 'minhas-chaves.json')
writeFileSync(keysFile, keysJson)

// ---------------------------------------------------------------- remover a ISO/ROM de um jogo instalado
const linkExists = (p) => { try { lstatSync(p); return true } catch { return false } }
const romGame = (() => {
  const base = { id: 'rom_remove_test', title: 'Jogo N64', projectName: 'n64port', repoFullName: 'x/n64port', githubUrl: '', console: 'Nintendo 64',
    consoleBadge: 'N64', version: '1', releaseStatus: 'Latest', isAiAssisted: false, platforms: ['Windows'], updatedAt: '', inferredFamily: 'GenericNative' }
  return { ...base, recipe: { id: 'rom_remove_test', repoFullName: 'x/n64port', title: 'Jogo N64', console: 'Nintendo 64', family: 'GenericNative',
    requirements: [{ id: 'rom', label: 'ROM do jogo', type: 'rom', expectedFilename: 'game.z64', extensions: ['.z64'] }] } }
})()

await test('remover a ISO/ROM: o atalho da pasta de instalação sai, o arquivo continua e arquivo real não é apagado', async () => {
  const romSrc = join(work, 'minhas-roms'); mkdirSync(romSrc, { recursive: true })
  const romFile = join(romSrc, 'meu-jogo.z64')
  writeFileSync(romFile, Buffer.concat([Buffer.from([0x80, 0x37, 0x12, 0x40]), Buffer.alloc(8192, 1)]))
  const installDir = join(installRoot, 'rom_remove_test'); mkdirSync(installDir, { recursive: true })
  writeFileSync(join(installDir, 'game.exe'), 'MZ')

  const entry = await romVault.importRomOrArchiveForGame(romFile, romGame, 'rom')
  let res = await recipeSvc.applyRecipe(romGame, installDir, await romVault.checkRomAvailability(romGame))
  assert.equal(res.status, 'READY_TO_PLAY')
  assert.ok(lstatSync(join(installDir, 'game.z64')).isSymbolicLink(), 'a ROM entrou por atalho')

  // o que a lixeira faz (vault:removeEntry sem apagar o arquivo) + reaplicar a receita
  vault = vault.filter((e) => e.filePath !== entry.filePath)
  res = await recipeSvc.applyRecipe(romGame, installDir, await romVault.checkRomAvailability(romGame))
  assert.equal(res.status, 'NEEDS_ROM', 'o jogo volta a pedir a ISO/ROM')
  assert.ok(!linkExists(join(installDir, 'game.z64')), 'o atalho saiu')
  assert.ok(existsSync(entry.filePath), 'o arquivo continua no computador')

  // um arquivo de verdade (não atalho) na pasta de instalação nunca é apagado pela receita
  writeFileSync(join(installDir, 'game.z64'), 'cópia do usuário')
  res = await recipeSvc.applyRecipe(romGame, installDir, await romVault.checkRomAvailability(romGame))
  assert.equal(readFileSync(join(installDir, 'game.z64'), 'utf8'), 'cópia do usuário')
  rmSync(installDir, { recursive: true, force: true })
})

await test('PKG sem arquivo de chaves: erro claro que explica o que fazer e não deixa lixo no Cofre', async () => {
  const g = { ...ps4Game, id: 'pkg_nokeys' }
  await assert.rejects(
    () => romVault.importRomOrArchiveForGame(pkgDir, g, 'bloodborne_dump'),
    (err) => /chaves/i.test(err.message) && /Configurações/.test(err.message) && /não inclui/.test(err.message)
  )
  assert.ok(!existsSync(join(vaultDir, 'pkg_nokeys', 'pkg-extraido')))
})

// ---- com o PKG Extractor que o usuário já tem instalado (sem nenhuma chave)
const extManifest = {
  'Jogo.v1.00.PS4-CUSA99999.pkg': { dir: 'CUSA99999', files: { 'eboot.bin': 'eboot 1.00', 'dvdroot_ps4/dados.bin': 'dados', 'sce_sys/param.sfo': 'sfo' } },
  'Jogo.v1.09.PATCH.PS4-CUSA99999.pkg': { dir: 'CUSA99999-patch', files: { 'eboot.bin': 'eboot 1.09 corrigido' } },
  'DLC01.pkg': { dir: 'CUSA99999/DLC0100000000000', files: { 'sce_sys/param.sfo': 'dlc' } },
  'Jogo.v1.09.60fps.MOD.PS4-CUSA99999.pkg': { dir: 'CUSA99999-patch', files: { 'eboot.bin': 'MOD 60fps' } },
  'Jogo.v1.09.30fps.MOD.PS4-CUSA99999.pkg': { dir: 'CUSA99999-patch', files: { 'eboot.bin': 'MOD 30fps' } }
}
const extCalls = (dir) => readFileSync(join(dir, 'calls.log'), 'utf8').split('\n').filter(Boolean)

await test('PKG com o PKG Extractor do usuário e SEM chaves: base + patch + DLC, mods de fora, jogo pronto', async () => {
  const extDir = join(work, 'extrator-ok')
  settings.pkgExtractorPath = writeFakeExtractor(extDir, extManifest)
  const g = { ...ps4Game, id: 'pkg_ext_folder' }
  const steps = []
  const entry = await romVault.importRomOrArchiveForGame(pkgDir, g, 'bloodborne_dump', (p, l) => steps.push([p, l]))
  assert.equal(entry.isDirectory, true)
  assert.equal(readFileSync(join(entry.filePath, 'eboot.bin'), 'utf8'), 'eboot 1.09 corrigido', 'patch por cima; mod ignorado')
  assert.ok(existsSync(join(entry.filePath, 'dvdroot_ps4', 'dados.bin')))
  assert.deepEqual(extCalls(extDir), ['Jogo.v1.00.PS4-CUSA99999.pkg', 'Jogo.v1.09.PATCH.PS4-CUSA99999.pkg', 'DLC01.pkg'])
  assert.ok(steps.some(([, l]) => /PKG Extractor/.test(l)), 'o progresso diz que usa o PKG Extractor')
  assert.ok(steps.some(([, l]) => /2 PKG\(s\) de mod ficaram de fora/.test(l)))
  assert.ok(steps.map(([p]) => p).every((p, i, a) => i === 0 || p >= a[i - 1] - 1), 'progresso não anda para trás')
  const status = await romVault.checkRomAvailability(g)
  assert.equal(status.ready, true)
  const patches = status.matchedRequirements.find((m) => m.requirement.type === 'patch')
  assert.equal(patches.localEntries.length, 1)
  assert.equal(patches.localEntries[0].fileName, 'DLC0100000000000')
  assert.ok(!existsSync(join(vaultDir, 'pkg_ext_folder', 'pkg-extraido.tmp')), 'sem pasta de trabalho sobrando')
})

await test('PKG com o PKG Extractor dentro de um .zip: extrai o zip, depois os .pkg, e apaga a cópia temporária', async () => {
  const zipPath = join(work, 'scene-ext.zip')
  py(`
import zipfile, glob, os
with zipfile.ZipFile(${JSON.stringify(zipPath)}, 'w', zipfile.ZIP_STORED) as z:
    for f in sorted(glob.glob(${JSON.stringify(pkgDir)} + '/*')):
        z.write(f, 'Jogo.v1.09.incl.DLC.PS4-CUSA99999/' + os.path.basename(f))
`)
  const g = { ...ps4Game, id: 'pkg_ext_zip' }
  const entry = await romVault.importRomOrArchiveForGame(zipPath, g, 'bloodborne_dump')
  assert.equal(readFileSync(join(entry.filePath, 'eboot.bin'), 'utf8'), 'eboot 1.09 corrigido')
  const leftovers = readdirSync(join(vaultDir, 'pkg_ext_zip'))
  assert.ok(!leftovers.some((n) => /^Jogo\.v1\.09/.test(n)), 'a cópia temporária dos .pkg foi apagada: ' + leftovers.join(', '))
})

await test('PKG Extractor que falha (avisa só no texto, código 0): erro claro e nada fica no Cofre', async () => {
  settings.pkgExtractorPath = writeFakeExtractor(join(work, 'extrator-falha'), {
    ...extManifest,
    'Jogo.v1.09.PATCH.PS4-CUSA99999.pkg': { dir: 'CUSA99999-patch', failure: 'extract', files: {} }
  })
  const g = { ...ps4Game, id: 'pkg_ext_fail' }
  await assert.rejects(
    () => romVault.importRomOrArchiveForGame(pkgDir, g, 'bloodborne_dump'),
    (err) => /Jogo\.v1\.09\.PATCH/.test(err.message) && /disco cheio/.test(err.message)
  )
  // nem o jogo base (já extraído antes do patch falhar) pode ficar ocupando o disco
  assert.ok(!existsSync(join(vaultDir, 'pkg_ext_fail', 'pkg-extraido')))
  assert.ok(!existsSync(join(vaultDir, 'pkg_ext_fail', 'pkg-extraido.tmp')))
  assert.ok(!existsSync(join(vaultDir, 'pkg_ext_fail', 'dlc-pkg')))
})

await test('arquivo escolhido que não é o PKG Extractor e sem chaves: o erro explica os dois caminhos', async () => {
  const fake = join(work, 'nao-e-o-extrator')
  writeFileSync(fake, '#!/bin/sh\necho ola\n')
  chmodSync(fake, 0o755)
  settings.pkgExtractorPath = fake
  const g = { ...ps4Game, id: 'pkg_ext_wrong' }
  await assert.rejects(
    () => romVault.importRomOrArchiveForGame(pkgDir, g, 'bloodborne_dump'),
    (err) => /não funcionou/.test(err.message) && /chaves/i.test(err.message) && /PKG Extractor/.test(err.message)
  )
  assert.ok(!existsSync(join(vaultDir, 'pkg_ext_wrong', 'pkg-extraido')))
})

settings.pkgExtractorPath = ''

settings.pkgKeysPath = keysFile

await test('PKG: pasta com base + patch + DLC é extraída sozinha (patch vale por cima; DLC vira patch do jogo)', async () => {
  const g = { ...ps4Game, id: 'pkg_folder' }
  const steps = []
  const entry = await romVault.importRomOrArchiveForGame(pkgDir, g, 'bloodborne_dump', (p, l) => steps.push([p, l]))
  assert.equal(entry.isDirectory, true)
  assert.ok(existsSync(join(entry.filePath, 'eboot.bin')))
  // as variantes de MOD NÃO entram: o eboot continua o do patch normal
  assert.equal(readFileSync(join(entry.filePath, 'eboot.bin'), 'utf8'), 'eboot 1.09 corrigido')
  assert.ok(steps.some(([, l]) => /2 PKG\(s\) de mod ficaram de fora/.test(l)), 'avisa que ignorou os mods')
  assert.ok(existsSync(join(entry.filePath, 'dvdroot_ps4', 'dados.bin')))
  assert.match(entry.extractedFromArchive, /^PKG:/)
  assert.ok(steps.some(([, l]) => /Extraindo .*\.pkg/.test(l)))
  assert.ok(steps.map(([p]) => p).every((p, i, a) => i === 0 || p >= a[i - 1] - 1), 'progresso não anda para trás')
  const status = await romVault.checkRomAvailability(g)
  assert.equal(status.ready, true)
  const patches = status.matchedRequirements.find((m) => m.requirement.type === 'patch')
  assert.equal(patches.localEntries.length, 1, 'o DLC entrou na lista de patches/DLC')
  assert.ok(existsSync(join(patches.localEntries[0].filePath, 'sce_sys', 'param.sfo')))
  assert.equal(patches.localEntries[0].fileName, 'DLC0100000000000', 'pasta do DLC com o rótulo, como os ports esperam')
})

await test('PKG: com o PKG Extractor E as chaves configurados, o extrator do usuário é o usado (as chaves são reserva)', async () => {
  const extDir = join(work, 'extrator-prioridade')
  settings.pkgExtractorPath = writeFakeExtractor(extDir, extManifest)
  const g = { ...ps4Game, id: 'pkg_ext_priority' }
  const entry = await romVault.importRomOrArchiveForGame(join(pkgDir, 'Jogo.v1.00.PS4-CUSA99999.pkg'), g, 'bloodborne_dump')
  assert.deepEqual(extCalls(extDir), ['Jogo.v1.00.PS4-CUSA99999.pkg'])
  assert.equal(readFileSync(join(entry.filePath, 'eboot.bin'), 'utf8'), 'eboot 1.00', 'conteúdo veio do extrator falso, não do motor próprio')
  settings.pkgExtractorPath = ''
})

await test('PKG: só patches (sem o jogo base) é recusado com uma explicação, sem deixar nada extraído', async () => {
  const g = { ...ps4Game, id: 'pkg_only_patch' }
  await assert.rejects(
    () => romVault.importRomOrArchiveForGame(join(pkgDir, 'Jogo.v1.09.PATCH.PS4-CUSA99999.pkg'), g, 'bloodborne_dump'),
    /falta o PKG do jogo base/
  )
  assert.ok(!existsSync(join(vaultDir, 'pkg_only_patch', 'pkg-extraido')))
})

await test('PKG: variantes de MOD entram se o usuário colocar o .pkg do mod junto do jogo (fora da pasta de mods)', async () => {
  const g = { ...ps4Game, id: 'pkg_mod_applied' }
  const folder = join(work, 'jogo-com-mod')
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'base.pkg'), buildPkg({ files: pkgGameFiles, category: 'gd', appVer: '01.00' }))
  writeFileSync(join(folder, 'patch.pkg'), buildPkg({ files: [{ path: 'eboot.bin', data: Buffer.from('eboot MOD escolhido') }], category: 'gp', appVer: '01.09' }))
  const entry = await romVault.importRomOrArchiveForGame(folder, g, 'bloodborne_dump')
  assert.equal(readFileSync(join(entry.filePath, 'eboot.bin'), 'utf8'), 'eboot MOD escolhido')
})

await test('PKG: zip com os .pkg dentro é extraído em duas etapas e a cópia temporária é apagada', async () => {
  const zipPath = join(work, 'scene.zip')
  py(`
import zipfile, glob, os
with zipfile.ZipFile(${JSON.stringify(zipPath)}, 'w', zipfile.ZIP_STORED) as z:
    for f in sorted(glob.glob(${JSON.stringify(pkgDir)} + '/*')):
        z.write(f, 'Jogo.v1.09.incl.DLC.PS4-CUSA99999/' + os.path.basename(f))
`)
  const g = { ...ps4Game, id: 'pkg_zip' }
  const entry = await romVault.importRomOrArchiveForGame(zipPath, g, 'bloodborne_dump')
  assert.ok(existsSync(join(entry.filePath, 'eboot.bin')))
  assert.equal(readFileSync(join(entry.filePath, 'eboot.bin'), 'utf8'), 'eboot 1.09 corrigido')
  const leftovers = readdirSync(join(vaultDir, 'pkg_zip'))
  assert.ok(!leftovers.some((n) => /^Jogo\.v1\.09/.test(n) || n === 'scene'), 'a cópia temporária dos .pkg foi apagada: ' + leftovers.join(', '))
})

await test('PKG: um único arquivo .pkg escolhido também funciona', async () => {
  const g = { ...ps4Game, id: 'pkg_single' }
  const entry = await romVault.importRomOrArchiveForGame(join(pkgDir, 'Jogo.v1.00.PS4-CUSA99999.pkg'), g, 'bloodborne_dump')
  assert.equal(readFileSync(join(entry.filePath, 'eboot.bin'), 'utf8'), 'eboot 1.00'.repeat(50))
})

await test('PKG com chaves erradas: erro claro e nada fica extraído', async () => {
  const other = makeKeyset()
  const wrongFile = join(work, 'chaves-erradas.json')
  const parsed = JSON.parse(keysJson)
  writeFileSync(wrongFile, JSON.stringify({ ...parsed, FakeKeyset: other.json }))
  const previous = settings.pkgKeysPath
  settings.pkgKeysPath = wrongFile
  const g = { ...ps4Game, id: 'pkg_wrongkeys' }
  await assert.rejects(
    () => romVault.importRomOrArchiveForGame(pkgDir, g, 'bloodborne_dump'),
    /chaves/i
  )
  assert.ok(!existsSync(join(vaultDir, 'pkg_wrongkeys', 'pkg-extraido')))
  settings.pkgKeysPath = previous
})

await test('PKG: patch .pkg ou .zip de atualização é extraído diretamente sobre o dump base já existente', async () => {
  const g = { ...ps4Game, id: 'pkg_patch_overlay' }
  // 1. Importa o jogo base v1.00
  const baseEntry = await romVault.importRomOrArchiveForGame(join(pkgDir, 'Jogo.v1.00.PS4-CUSA99999.pkg'), g, 'bloodborne_dump')
  assert.equal(readFileSync(join(baseEntry.filePath, 'eboot.bin'), 'utf8'), 'eboot 1.00'.repeat(50))

  // 2. Importa o patch v1.09 diretamente como requisito de patch
  const patchPkgPath = join(pkgDir, 'Jogo.v1.09.PATCH.PS4-CUSA99999.pkg')
  const patchEntry = await romVault.importRomOrArchiveForGame(patchPkgPath, g, 'patches')
  assert.equal(patchEntry.kind, 'patch')
  assert.equal(readFileSync(join(baseEntry.filePath, 'eboot.bin'), 'utf8'), 'eboot 1.09 corrigido', 'o patch sobrescreveu o eboot.bin do dump base')

  // 3. Testa também patch dentro de um .zip contendo .pkg
  const patchZip = join(work, 'update-archive.zip')
  py(`
import zipfile
with zipfile.ZipFile(${JSON.stringify(patchZip)}, 'w', zipfile.ZIP_STORED) as z:
    z.write(${JSON.stringify(patchPkgPath)}, 'update.pkg')
`)
  const zipPatchEntry = await romVault.importRomOrArchiveForGame(patchZip, g, 'patches')
  assert.equal(zipPatchEntry.kind, 'patch')
  assert.ok(existsSync(zipPatchEntry.filePath), 'o arquivo de patch original .zip é preservado no cofre')
})

await test('cofre: varredura não hasheia o conteúdo de dumps extraídos nem esquece pastas/patches', async () => {
  const dumpEntry = vault.find((e) => e.isDirectory && e.fileName === 'CUSA03173')
  assert.ok(dumpEntry)
  await romVault.scanDirectory(vaultDir)
  assert.ok(vault.some((e) => e.filePath === dumpEntry.filePath), 'pasta extraída deve sobreviver à varredura')
  assert.ok(vault.some((e) => e.kind === 'patch'), 'patches devem sobreviver à varredura')
  assert.ok(!vault.some((e) => e.fileName === 'data.pak' && e.filePath.startsWith(dumpEntry.filePath)), 'arquivos internos do dump não entram no cofre')
})

// ----------------------------------------------------------------
rmSync(work, { recursive: true, force: true })
const failed = results.filter(([ok]) => !ok).length
if (failed) { console.error(`\n${failed} teste(s) falharam`); process.exit(1) }
console.log(`\n${results.length} testes OK${BIG ? '' : ' (use --big para o teste de zip acima de 2 GiB)'}`)
