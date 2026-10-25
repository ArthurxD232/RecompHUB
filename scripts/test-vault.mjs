// Teste do cofre/receitas com arquivos grandes, pastas e patches: node scripts/test-vault.mjs [--big]
//   --big  também cria e extrai um .zip de ~2,3 GB (o limite de 2 GiB do Node derrubava o AdmZip).
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, lstatSync, readdirSync, statSync, readlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'

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

const vaultDir = join(work, 'vault')
const installRoot = join(work, 'games')
mkdirSync(vaultDir, { recursive: true })
mkdirSync(installRoot, { recursive: true })

// Store falso, com o mesmo comportamento de mesclagem do real
const settings = {
  romVaultPath: vaultDir,
  installRootPath: installRoot,
  linkStrategy: 'symlink',
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
