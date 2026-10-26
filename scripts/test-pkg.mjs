// Teste do extrator de PKG (PS4): node scripts/test-pkg.mjs
//
// Não usa NENHUMA chave da Sony: o teste gera chaves RSA próprias e monta PKGs "fake" sintéticos
// seguindo o formato (RSA -> chave derivada 3 -> imagem key -> EKPFS -> AES-XTS -> PFS externo ->
// pfs_image.dat (PFSC com blocos comprimidos) -> PFS interno). A criptografia dos dados é feita
// com o AES-XTS do OpenSSL, uma implementação independente da usada pelo app.
import { build } from 'esbuild'
import * as crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import assert from 'node:assert/strict'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const work = mkdtempSync(join(tmpdir(), 'recomphub-pkg-test-'))

const bundleFile = join(work, 'pkg.cjs')
await build({
  entryPoints: [join(root, 'src/main/services/pkg/index.ts')],
  outfile: bundleFile,
  bundle: true,
  format: 'cjs',
  platform: 'node',
  logLevel: 'error'
})
const engine = require(bundleFile)

import { BLOCK, buildPkg, derived3Keyset, fakeKeyset, keysJson, makeKeyset } from './lib/synthetic-pkg.mjs'
import { writeFakeExtractor } from './lib/fake-extractor.mjs'

const keys = engine.parsePkgKeys(keysJson)

// ------------------------------------------------------------------ dados de teste
const bigText = Buffer.from('Bloodborne teste de compressao. '.repeat(20000)) // ~640 KB, comprime bem
const randomBin = crypto.randomBytes(300 * 1024) // não comprime
const gameFiles = [
  { path: 'eboot.bin', data: crypto.randomBytes(150_000) },
  { path: 'sce_sys/param.sfo', data: Buffer.from('param') },
  { path: 'sce_sys/icon0.png', data: crypto.randomBytes(5000) },
  { path: 'dvdroot_ps4/data/big.txt', data: bigText },
  { path: 'dvdroot_ps4/data/random.bin', data: randomBin },
  { path: 'dvdroot_ps4/vazio.dat', data: Buffer.alloc(0) },
  { path: 'sce_module/libc.prx', data: crypto.randomBytes(70_000) }
]

const results = []
async function test(name, fn) {
  try {
    await fn()
    results.push(true)
    console.log(`  ok   ${name}`)
  } catch (err) {
    results.push(false)
    console.log(`  FAIL ${name}\n       ${String(err.stack || err).split('\n').slice(0, 5).join('\n       ')}`)
  }
}

function listTree(dir, base = dir, out = {}) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isDirectory()) listTree(full, base, out)
    else out[full.slice(base.length + 1).replaceAll('\\', '/')] = readFileSync(full)
  }
  return out
}

async function extractAndCompare(pkgBuf, name, expectedFiles) {
  const pkgPath = join(work, `${name}.pkg`)
  writeFileSync(pkgPath, pkgBuf)
  const session = await engine.PkgSession.open(pkgPath, keys)
  try {
    assert.equal(session.files.length, expectedFiles.length)
    const out = join(work, `out-${name}`)
    let bytes = 0
    const count = await session.extractTo(out, (n) => (bytes += n))
    assert.equal(count, expectedFiles.length)
    assert.equal(bytes, session.totalBytes)
    const tree = listTree(out)
    for (const f of expectedFiles) {
      assert.ok(tree[f.path], `faltou ${f.path}`)
      assert.ok(tree[f.path].equals(f.data), `conteúdo diferente em ${f.path}`)
    }
    return session.info
  } finally {
    await session.close()
  }
}

await test('PKG fake: extrai tudo igual ao original (PFS interno sem assinatura, PFSC comprimido)', async () => {
  const info = await extractAndCompare(buildPkg({ files: gameFiles }), 'basico', gameFiles)
  assert.equal(info.titleId, 'CUSA99999')
  assert.equal(info.title, 'Jogo de Teste')
  assert.equal(info.kind, 'game')
})

await test('PKG fake: PFS interno assinado, arquivos com blocos espalhados (bloco indireto)', async () => {
  const scattered = [
    { path: 'a/grande_a.bin', data: crypto.randomBytes(BLOCK * 20 + 123), scatter: true },
    { path: 'b/grande_b.bin', data: crypto.randomBytes(BLOCK * 18 + 77), scatter: true },
    { path: 'eboot.bin', data: crypto.randomBytes(1000) }
  ]
  await extractAndCompare(buildPkg({ files: scattered, signedInner: true }), 'espalhado', scattered)
})

await test('PKG fake: sem compressão e com a variante de cripto nova (flag 0x2000...)', async () => {
  await extractAndCompare(buildPkg({ files: gameFiles, compress: false, newCrypt: true }), 'novacripto', gameFiles)
})

await test('PKG: informações (título, versão, tipo) sem precisar das chaves', async () => {
  const p = join(work, 'patch.pkg')
  writeFileSync(p, buildPkg({ files: gameFiles.slice(0, 2), category: 'gp', appVer: '01.09', title: 'Patch 1.09' }))
  const info = await engine.readPkgInfo(p)
  assert.equal(info.kind, 'patch')
  assert.equal(info.appVersion, '01.09')
  const d = join(work, 'dlc.pkg')
  writeFileSync(d, buildPkg({ files: gameFiles.slice(0, 2), category: 'ac', contentType: 0x1b }))
  assert.equal((await engine.readPkgInfo(d)).kind, 'addon')
  const delta = join(work, 'delta.pkg')
  writeFileSync(delta, buildPkg({ files: gameFiles.slice(0, 2), contentType: 0x1e }))
  await assert.rejects(() => engine.PkgSession.open(delta, keys), /patch delta/)
})

await test('chaves erradas: erro claro (PkgKeyError), sem extrair nada', async () => {
  const other = makeKeyset()
  const wrong = engine.parsePkgKeys(
    JSON.stringify({ FakeKeyset: other.json, PkgDerivedKey3Keyset: derived3Keyset.json })
  )
  const p = join(work, 'chaves-erradas.pkg')
  writeFileSync(p, buildPkg({ files: gameFiles.slice(0, 2) }))
  await assert.rejects(
    () => engine.PkgSession.open(p, wrong),
    (err) => err instanceof engine.PkgKeyError && /chaves/i.test(err.message)
  )
})

await test('arquivo que não é PKG ou está truncado: erro claro, sem travar', async () => {
  const junk = join(work, 'lixo.pkg')
  writeFileSync(junk, crypto.randomBytes(20000))
  await assert.rejects(() => engine.PkgSession.open(junk, keys), /não é um PKG/)
  const full = buildPkg({ files: gameFiles })
  const cut = join(work, 'cortado.pkg')
  writeFileSync(cut, full.subarray(0, Math.floor(full.length * 0.6)))
  await assert.rejects(async () => {
    const s = await engine.PkgSession.open(cut, keys)
    try {
      await s.extractTo(join(work, 'out-cortado'))
    } finally {
      await s.close()
    }
  })
})

await test('arquivo de chaves: formato do shadPS4, validações e mensagens', async () => {
  assert.throws(() => engine.parsePkgKeys('isto nao e json'), /JSON/)
  assert.throws(() => engine.parsePkgKeys('{}'), /FakeKeyset/)
  assert.throws(
    () => engine.parsePkgKeys(JSON.stringify({ FakeKeyset: { Modulus: 'zz', PrivateExponent: '01' }, PkgDerivedKey3Keyset: {} })),
    /Modulus/
  )
  assert.ok(engine.parsePkgKeys(keysJson).fake.n > 0n)
})

await test('merge: base + patch — o patch sobrescreve arquivos do jogo base', async () => {
  const base = [
    { path: 'eboot.bin', data: Buffer.from('eboot antigo') },
    { path: 'dados/a.bin', data: Buffer.from('a') }
  ]
  const patch = [{ path: 'eboot.bin', data: Buffer.from('eboot 1.09 novo') }]
  const dir = join(work, 'merge-in')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'patch.pkg'), buildPkg({ files: patch, category: 'gp', appVer: '01.09' }))
  writeFileSync(join(dir, 'base.pkg'), buildPkg({ files: base, category: 'gd', appVer: '01.00' }))
  const out = join(work, 'merge-out')
  const res = await engine.extractPkgSet(
    [join(dir, 'patch.pkg'), join(dir, 'base.pkg')],
    out,
    keys
  )
  assert.equal(readFileSync(join(out, 'eboot.bin'), 'utf8'), 'eboot 1.09 novo')
  assert.equal(readFileSync(join(out, 'dados/a.bin'), 'utf8'), 'a')
  assert.deepEqual(res.applied.map((p) => p.kind), ['game', 'patch'])
})

// ------------------------------------------------------------------ PKG Extractor externo
// (o do usuário, que o RecompHUB só executa: aqui um "pkg_extractor" falso imita o comportamento real)
const GAME = 'CUSA99999'
const DLC_LABEL = 'DLC0100000000000'
const extIn = join(work, 'ext-in')
mkdirSync(join(extIn, 'MODs'), { recursive: true })
const extPkgs = {
  base: join(extIn, 'base.pkg'),
  patch: join(extIn, 'patch.pkg'),
  dlc: join(extIn, 'dlc.pkg'),
  mod: join(extIn, 'MODs', 'mod60.pkg')
}
writeFileSync(extPkgs.base, buildPkg({ files: gameFiles.slice(0, 2), category: 'gd', appVer: '01.00' }))
writeFileSync(extPkgs.patch, buildPkg({ files: gameFiles.slice(0, 2), category: 'gp', appVer: '01.09' }))
writeFileSync(extPkgs.dlc, buildPkg({ files: gameFiles.slice(0, 2), category: 'ac', contentType: 0x1b, contentId: `UP9000-${GAME}_00-${DLC_LABEL}` }))
writeFileSync(extPkgs.mod, buildPkg({ files: gameFiles.slice(0, 2), category: 'gp', appVer: '01.09' }))

const goodManifest = {
  'base.pkg': { dir: GAME, delayMs: 200, files: { 'eboot.bin': 'eboot antigo', 'dados/a.bin': 'a', 'sce_sys/param.sfo': 'base' } },
  'patch.pkg': { dir: `${GAME}-patch`, files: { 'eboot.bin': 'eboot 1.09', 'novo.bin': 'n' } },
  'dlc.pkg': { dir: `${GAME}/${DLC_LABEL}`, files: { 'sce_sys/param.sfo': 'dlc' } },
  'mod60.pkg': { dir: `${GAME}-patch`, files: { 'eboot.bin': 'MOD 60fps' } }
}
const calls = (dir) => readFileSync(join(dir, 'calls.log'), 'utf8').split('\n').filter(Boolean)

await test('PKG Extractor externo: base, patch por cima, DLC com rótulo e MOD de fora (ordem certa)', async () => {
  const dir = join(work, 'fake-ok')
  const extractor = writeFakeExtractor(dir, goodManifest)
  const out = join(work, 'ext-out', 'pkg-extraido')
  const addons = join(work, 'ext-out', 'dlc-pkg')
  const events = []
  // fora de ordem de propósito: o RecompHUB é quem decide base -> patch -> DLC
  const res = await engine.extractPkgSetExternal([extPkgs.mod, extPkgs.dlc, extPkgs.patch, extPkgs.base], out, extractor, {
    addonsDir: addons,
    onProgress: (p) => events.push(p)
  })
  assert.deepEqual(calls(dir), ['base.pkg', 'patch.pkg', 'dlc.pkg'], 'ordem das chamadas; o MOD nem é executado')
  assert.equal(readFileSync(join(out, 'eboot.bin'), 'utf8'), 'eboot 1.09', 'o patch vale por cima do jogo')
  assert.equal(readFileSync(join(out, 'dados/a.bin'), 'utf8'), 'a', 'arquivos só do base continuam')
  assert.equal(readFileSync(join(out, 'novo.bin'), 'utf8'), 'n', 'arquivos só do patch entram')
  assert.equal(readFileSync(join(addons, DLC_LABEL, 'sce_sys/param.sfo'), 'utf8'), 'dlc', 'DLC na pasta do rótulo')
  assert.deepEqual(res.applied.map((i) => i.kind), ['game', 'patch'])
  assert.equal(res.skipped.length, 1)
  assert.equal(res.addons.length, 1)
  assert.equal(res.addons[0].dir, join(addons, DLC_LABEL))
  assert.ok(!existsSync(out + '.tmp'), 'pasta de trabalho apagada')
  assert.equal(events.at(-1).percent, 100)
  assert.ok(events.every((e, i) => i === 0 || e.percent >= events[i - 1].percent), 'progresso não anda para trás')
  assert.ok(events.some((e) => /arquivo \d+ de \d+/.test(e.detail || '')), 'mostra "arquivo X de N"')
})

async function failureCase(name, entryOverride, expected) {
  await test(`PKG Extractor externo: ${name}`, async () => {
    const dir = join(work, `fake-${name.replace(/\W+/g, '-')}`)
    const extractor = writeFakeExtractor(dir, { ...goodManifest, 'base.pkg': { ...goodManifest['base.pkg'], ...entryOverride } })
    const out = join(work, `fail-${name.replace(/\W+/g, '-')}`, 'pkg-extraido')
    await assert.rejects(() => engine.extractPkgSetExternal([extPkgs.base], out, extractor), expected)
    assert.ok(!existsSync(out + '.tmp'), 'sem pasta de trabalho sobrando')
    assert.ok(!existsSync(out), 'nada fica registrado como extraído')
  })
}
// O extrator real sai com código 0 mesmo falhando: o sucesso não pode ser julgado pelo código
await failureCase('falha avisada só no texto (código 0) é detectada', { failure: 'extract' }, /falha ao extrair o PKG \(disco cheio\)/)
await failureCase('PKG que ele não consegue abrir (código 0)', { failure: 'open' }, /não foi possível abrir o PKG \(chave invalida\)/)
await failureCase('terminou sem gerar arquivos', { failure: 'silent' }, /sem gerar arquivos/)
await failureCase('terminou com código de erro', { failure: 'exit' }, /código 3/)

await test('PKG Extractor externo: delta e "só patch" são recusados antes de executar o extrator', async () => {
  const dir = join(work, 'fake-plan')
  const extractor = writeFakeExtractor(dir, goodManifest)
  await assert.rejects(
    () => engine.extractPkgSetExternal([extPkgs.patch], join(work, 'plan-out', 'x'), extractor),
    /falta o PKG do jogo base/
  )
  assert.deepEqual(calls(dir), [], 'o extrator nem foi chamado')
})

await test('PKG Extractor externo: conferência do executável (é o extrator? abre aqui?)', async () => {
  const dir = join(work, 'fake-probe')
  const good = writeFakeExtractor(dir, goodManifest)
  assert.deepEqual(await engine.probePkgExtractor(good), { ok: true })

  // um programa qualquer não é aceito como PKG Extractor
  const other = join(work, 'outro-programa')
  writeFileSync(other, '#!/bin/sh\necho ola mundo\n')
  chmodSync(other, 0o755)
  const bad = await engine.probePkgExtractor(other)
  assert.equal(bad.ok, false)
  assert.match(bad.error, /não parece ser o PKG Extractor/)

  assert.equal((await engine.probePkgExtractor(join(work, 'nao-existe'))).ok, false)

  // quem baixou o .AppImage e esqueceu do chmod +x: o RecompHUB ajusta a permissão
  const noExec = writeFakeExtractor(join(work, 'fake-noexec'), goodManifest, 'pkg_extractor.AppImage')
  chmodSync(noExec, 0o644)
  assert.equal((await engine.probePkgExtractor(noExec)).ok, true)
  assert.ok((statSync(noExec).mode & 0o100) !== 0)
})

await test('PKG Extractor externo: acha o que o usuário já tem (escolhido, pasta, variável, Downloads, PATH)', async () => {
  const saved = { HOME: process.env.HOME, PATH: process.env.PATH, ENV: process.env.RECOMPHUB_PKG_EXTRACTOR }
  try {
    delete process.env.RECOMPHUB_PKG_EXTRACTOR
    const home = join(work, 'home-find')
    mkdirSync(home, { recursive: true })
    process.env.HOME = home

    // escolhido pelo usuário: o arquivo, ou a pasta que o contém (o zip do extrator abre numa pasta)
    const chosen = writeFakeExtractor(join(work, 'escolhido'), goodManifest)
    assert.deepEqual(engine.findExternalPkgExtractor(chosen), { path: chosen, source: 'config' })
    const zipFolder = join(work, 'ShadPs4Plus-PkgExtractor-1.1-linux')
    const inFolder = writeFakeExtractor(zipFolder, goodManifest, 'ShadPs4Plus-PkgExtractor-1.1-linux.AppImage')
    assert.deepEqual(engine.findExternalPkgExtractor(zipFolder), { path: inFolder, source: 'config' })

    // variável de ambiente
    process.env.RECOMPHUB_PKG_EXTRACTOR = chosen
    assert.deepEqual(engine.findExternalPkgExtractor(''), { path: chosen, source: 'detected' })
    delete process.env.RECOMPHUB_PKG_EXTRACTOR

    // pasta Downloads, inclusive dentro da pasta do zip
    const dl = writeFakeExtractor(join(home, 'Downloads', 'PKG_EXTRACTOR_1_1'), goodManifest, 'pkg_extractor.AppImage')
    assert.deepEqual(engine.findExternalPkgExtractor(''), { path: dl, source: 'detected' })
    rmSync(join(home, 'Downloads'), { recursive: true, force: true })

    // PATH
    const bin = join(work, 'bin-path')
    const onPath = writeFakeExtractor(bin, goodManifest, 'pkg_extractor')
    process.env.PATH = bin + delimiter + saved.PATH
    assert.deepEqual(engine.findExternalPkgExtractor(''), { path: onPath, source: 'detected' })

    // um caminho escolhido que sumiu não derruba nada: cai para a detecção
    assert.equal(engine.findExternalPkgExtractor(join(work, 'sumiu')).source, 'detected')
  } finally {
    process.env.HOME = saved.HOME
    process.env.PATH = saved.PATH
    if (saved.ENV === undefined) delete process.env.RECOMPHUB_PKG_EXTRACTOR
    else process.env.RECOMPHUB_PKG_EXTRACTOR = saved.ENV
  }
})

if (process.argv.includes('--bench')) {
  // Desempenho com um PKG grande (compressível + incompressível), como um jogo de verdade
  const mb = 300
  const big = [
    { path: 'eboot.bin', data: crypto.randomBytes(2_000_000) },
    { path: 'data/comprimivel.dat', data: Buffer.from('dados repetidos de jogo '.repeat((mb * 1024 * 1024) / 25 / 2)) },
    { path: 'data/aleatorio.dat', data: crypto.randomBytes((mb * 1024 * 1024) / 2) }
  ]
  const pkgBuf = buildPkg({ files: big })
  const p = join(work, 'bench.pkg')
  writeFileSync(p, pkgBuf)
  const session = await engine.PkgSession.open(p, keys)
  const t0 = process.hrtime.bigint()
  await session.extractTo(join(work, 'out-bench'))
  const secs = Number(process.hrtime.bigint() - t0) / 1e9
  const rate = session.totalBytes / 1048576 / secs
  console.log(`  bench: ${(session.totalBytes / 1048576).toFixed(0)} MiB em ${secs.toFixed(1)}s = ${rate.toFixed(0)} MiB/s  ->  30 GB levaria ~${Math.round((30 * 1024) / rate / 60)} min`)
  await session.close()
}

rmSync(work, { recursive: true, force: true })
const failed = results.filter((r) => !r).length
if (failed) {
  console.error(`\n${failed} teste(s) falharam`)
  process.exit(1)
}
console.log(`\n${results.length} testes OK`)
