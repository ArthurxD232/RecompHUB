// Construtor de PKGs "fake" SINTÉTICOS para testes. Não usa nenhuma chave da Sony:
// gera chaves RSA próprias e segue o formato (RSA -> chave derivada 3 -> chave da imagem -> EKPFS ->
// AES-XTS -> PFS externo -> pfs_image.dat (PFSC) -> PFS interno). Os dados são criptografados com o
// AES-XTS do OpenSSL, uma implementação independente da usada pelo app.
import * as crypto from 'node:crypto'
import * as zlib from 'node:zlib'
import assert from 'node:assert/strict'

// ------------------------------------------------------------------ chaves de teste
export function makeKeyset() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = privateKey.export({ format: 'jwk' })
  const hex = (b64) => Buffer.from(b64, 'base64url').toString('hex')
  return { privateKey, publicKey, json: { Modulus: hex(jwk.n), PrivateExponent: hex(jwk.d), PublicExponent: hex(jwk.e) } }
}
export const fakeKeyset = makeKeyset()
export const derived3Keyset = makeKeyset()
export const keysJson = JSON.stringify({ FakeKeyset: fakeKeyset.json, PkgDerivedKey3Keyset: derived3Keyset.json })

// ------------------------------------------------------------------ construtor de PFS
export const BLOCK = 0x10000
const align = (n, a) => Math.ceil(n / a) * a

function buildInode({ signed, size, blocks, start, direct, indirect, isDir }) {
  const size_ = signed ? 0x2c8 : 0xa8
  const b = Buffer.alloc(size_)
  b.writeUInt16LE(isDir ? 0x41ed : 0x81a4, 0)
  b.writeUInt16LE(1, 2)
  b.writeBigInt64LE(BigInt(size), 8)
  b.writeBigInt64LE(BigInt(size), 0x10)
  b.writeUInt32LE(blocks, 0x60)
  const db = new Array(12).fill(-1)
  const ib = new Array(5).fill(-1)
  if (direct) direct.forEach((v, i) => (db[i] = v))
  else if (blocks > 0) db[0] = start
  if (indirect) indirect.forEach((v, i) => (ib[i] = v))
  if (signed) {
    db.forEach((v, i) => b.writeInt32LE(v, 0x64 + i * 36 + 32))
    ib.forEach((v, i) => b.writeInt32LE(v, 0x64 + 12 * 36 + i * 36 + 32))
  } else {
    db.forEach((v, i) => b.writeInt32LE(v, 0x64 + i * 4))
    ib.forEach((v, i) => b.writeInt32LE(v, 0x64 + 12 * 4 + i * 4))
  }
  return b
}

function dirent(ino, type, name) {
  const entSize = align(name.length + 17, 8)
  const b = Buffer.alloc(entSize)
  b.writeUInt32LE(ino, 0)
  b.writeInt32LE(type, 4)
  b.writeInt32LE(name.length, 8)
  b.writeInt32LE(entSize, 12)
  b.write(name, 16, 'latin1')
  return b
}

/**
 * files: [{ path: 'dir/arq.bin', data: Buffer, scatter?: true }]
 * scatter: espalha os blocos do arquivo (não contíguo) — só em imagens "signed".
 */
function buildPfs({ files, signed, encrypted, seed, mode: modeOverride }) {
  // árvore de diretórios
  const dirs = new Set([''])
  for (const f of files) {
    const parts = f.path.split('/')
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'))
  }
  const dirList = [...dirs].sort()
  // inodes: 0 = raiz, 1 = uroot (= dir ''), depois demais dirs, depois arquivos
  const inodeOfDir = new Map([['', 1]])
  let next = 2
  for (const d of dirList) if (d !== '') inodeOfDir.set(d, next++)
  const fileInodes = files.map(() => next++)
  const inodeCount = next

  const dinodeSize = signed ? 0x2c8 : 0xa8
  const perBlock = Math.floor(BLOCK / dinodeSize)
  const dinodeBlocks = Math.ceil(inodeCount / perBlock)
  let nextBlock = 1 + dinodeBlocks
  const alloc = (n) => {
    const start = nextBlock
    nextBlock += n
    return start
  }

  const nodes = new Array(inodeCount)
  const dataParts = [] // { block, data }

  // diretórios
  const makeDirData = (self, parent, entries) =>
    Buffer.concat([dirent(self, 4, '.'), dirent(parent, 5, '..'), ...entries.map(([ino, type, name]) => dirent(ino, type, name))])
  const dirBlocks = new Map()
  const rootData = makeDirData(0, 0, [[1, 3, 'uroot']])
  const rootBlock = alloc(1)
  nodes[0] = buildInode({ signed, size: rootData.length, blocks: 1, start: rootBlock, isDir: true })
  dataParts.push({ block: rootBlock, data: rootData })
  for (const d of dirList) {
    const entries = []
    for (const sub of dirList) {
      if (sub !== '' && sub.split('/').slice(0, -1).join('/') === d) entries.push([inodeOfDir.get(sub), 3, sub.split('/').pop()])
    }
    files.forEach((f, i) => {
      if (f.path.split('/').slice(0, -1).join('/') === d) entries.push([fileInodes[i], 2, f.path.split('/').pop()])
    })
    const data = makeDirData(inodeOfDir.get(d), d === '' ? 0 : inodeOfDir.get(d.split('/').slice(0, -1).join('/')), entries)
    const block = alloc(1)
    dirBlocks.set(d, block)
    nodes[inodeOfDir.get(d)] = buildInode({ signed, size: data.length, blocks: 1, start: block, isDir: true })
    dataParts.push({ block, data })
  }

  // arquivos (os "scatter" têm blocos intercalados)
  const scatterIdx = files.map((f, i) => (f.scatter ? i : -1)).filter((i) => i >= 0)
  const scatterBlocks = new Map()
  if (scatterIdx.length > 0) {
    const counts = scatterIdx.map((i) => Math.max(1, Math.ceil(files[i].data.length / BLOCK)))
    const maxCount = Math.max(...counts)
    const base = nextBlock
    nextBlock += counts.reduce((a, b) => a + b, 0)
    scatterIdx.forEach((i) => scatterBlocks.set(i, []))
    let cursor = base
    for (let k = 0; k < maxCount; k++) {
      scatterIdx.forEach((i, pos) => {
        if (k < counts[pos]) scatterBlocks.get(i).push(cursor++)
      })
    }
  }
  files.forEach((f, i) => {
    const n = f.data.length === 0 ? 0 : Math.ceil(f.data.length / BLOCK)
    if (f.scatter) {
      const blocks = scatterBlocks.get(i)
      assert.ok(signed, 'scatter só em imagens signed')
      const direct = blocks.slice(0, 12)
      let indirect = null
      if (blocks.length > 12) {
        const indBlock = alloc(1)
        const buf = Buffer.alloc(BLOCK)
        blocks.slice(12).forEach((blk, j) => buf.writeInt32LE(blk, j * 36 + 32))
        dataParts.push({ block: indBlock, data: buf })
        indirect = [indBlock]
      }
      nodes[fileInodes[i]] = buildInode({ signed, size: f.data.length, blocks: blocks.length, direct, indirect })
      blocks.forEach((blk, j) => dataParts.push({ block: blk, data: f.data.subarray(j * BLOCK, (j + 1) * BLOCK) }))
    } else {
      const start = n === 0 ? 0 : alloc(n)
      nodes[fileInodes[i]] = buildInode({ signed, size: f.data.length, blocks: n, start })
      if (n > 0) dataParts.push({ block: start, data: f.data })
    }
  })

  const total = nextBlock * BLOCK
  const image = Buffer.alloc(total)
  // cabeçalho
  image.writeBigInt64LE(1n, 0)
  image.writeBigInt64LE(20130315n, 8)
  const mode = modeOverride ?? ((signed ? 1 : 0) | (encrypted ? 4 : 0) | 8)
  image.writeUInt16LE(mode, 0x1c)
  image.writeUInt32LE(BLOCK, 0x20)
  image.writeBigInt64LE(1n, 0x28)
  image.writeBigInt64LE(BigInt(inodeCount), 0x30)
  image.writeBigInt64LE(BigInt(dinodeBlocks), 0x40)
  if (seed) seed.copy(image, 0x370)
  // inodes
  nodes.forEach((n, i) => {
    const block = Math.floor(i / perBlock)
    n.copy(image, BLOCK + block * BLOCK + (i % perBlock) * dinodeSize)
  })
  for (const part of dataParts) part.data.copy(image, part.block * BLOCK)
  return image
}

function buildPfsc(inner, { compress = true } = {}) {
  const padded = Buffer.alloc(align(inner.length, BLOCK))
  inner.copy(padded)
  const blocks = padded.length / BLOCK
  const mapOffset = 0x400
  const dataStart = align(mapOffset + (blocks + 1) * 8, 0x1000)
  const chunks = []
  const map = []
  let pos = dataStart
  for (let i = 0; i < blocks; i++) {
    const block = padded.subarray(i * BLOCK, (i + 1) * BLOCK)
    map.push(pos)
    let stored = block
    if (compress) {
      const z = zlib.deflateSync(block) // 2 bytes de cabeçalho + deflate + adler32, como o leitor espera
      if (z.length < BLOCK) stored = z
    }
    chunks.push(stored)
    pos += stored.length
  }
  map.push(pos)
  const out = Buffer.alloc(pos)
  out.writeInt32LE(0x43534650, 0)
  out.writeInt32LE(0, 4)
  out.writeInt32LE(6, 8)
  out.writeInt32LE(BLOCK, 0xc)
  out.writeBigInt64LE(BigInt(BLOCK), 0x10)
  out.writeBigInt64LE(BigInt(mapOffset), 0x18)
  out.writeBigUInt64LE(BigInt(dataStart), 0x20)
  out.writeBigInt64LE(BigInt(padded.length), 0x28)
  map.forEach((v, i) => out.writeBigInt64LE(BigInt(v), mapOffset + i * 8))
  let o = dataStart
  for (const c of chunks) {
    c.copy(out, o)
    o += c.length
  }
  return out
}

// ------------------------------------------------------------------ construtor de PKG
function buildSfo(fields) {
  const keys = Object.keys(fields)
  const keyTable = Buffer.concat(keys.map((k) => Buffer.from(k + '\0')))
  const entries = []
  const dataParts = []
  let keyOff = 0
  let dataOff = 0
  for (const k of keys) {
    const v = fields[k]
    const data = typeof v === 'number' ? Buffer.alloc(4) : Buffer.from(v + '\0')
    if (typeof v === 'number') data.writeUInt32LE(v)
    const e = Buffer.alloc(16)
    e.writeUInt16LE(keyOff, 0)
    e.writeUInt16LE(typeof v === 'number' ? 0x0404 : 0x0204, 2)
    e.writeUInt32LE(typeof v === 'number' ? 4 : data.length, 4)
    e.writeUInt32LE(typeof v === 'number' ? 4 : data.length, 8)
    e.writeUInt32LE(dataOff, 12)
    entries.push(e)
    dataParts.push(data)
    keyOff += k.length + 1
    dataOff += data.length
  }
  const keyTableOffset = 20 + keys.length * 16
  const header = Buffer.alloc(20)
  header.writeUInt32BE(0x00505346, 0)
  header.writeUInt32LE(0x101, 4)
  header.writeUInt32LE(keyTableOffset, 8)
  header.writeUInt32LE(keyTableOffset + align(keyTable.length, 4), 12)
  header.writeUInt32LE(keys.length, 16)
  return Buffer.concat([header, ...entries, keyTable, Buffer.alloc(align(keyTable.length, 4) - keyTable.length), ...dataParts])
}

function metaBytes(m) {
  const b = Buffer.alloc(32)
  b.writeUInt32BE(m.id, 0)
  b.writeUInt32BE(m.nameOffset ?? 0, 4)
  b.writeUInt32BE(m.flags1 ?? 0, 8)
  b.writeUInt32BE(m.flags2 ?? 0, 12)
  b.writeUInt32BE(m.dataOffset, 16)
  b.writeUInt32BE(m.dataSize, 20)
  return b
}

/**
 * Monta um PKG "fake" completo.
 * opts: { files, signedInner, compress, contentId, title, category, contentType, newCrypt, wrongKeys }
 */
export function buildPkg(opts) {
  const {
    files,
    signedInner = false,
    compress = true,
    contentId = 'UP9000-CUSA99999_00-TESTGAME00000000',
    title = 'Jogo de Teste',
    category = 'gd',
    contentType = 0x1a,
    newCrypt = false,
    appVer = '01.00'
  } = opts
  const ekpfs = crypto.randomBytes(32)
  const dk3 = crypto.randomBytes(32)
  const seed = crypto.randomBytes(16)

  // imagens
  const inner = buildPfs({ files, signed: signedInner, encrypted: false })
  const pfsc = buildPfsc(inner, { compress })
  const outerPlain = buildPfs({ files: [{ path: 'pfs_image.dat', data: pfsc }], signed: true, encrypted: true, seed })

  // XTS (OpenSSL) a partir do setor 16
  const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest()
  const idx = Buffer.alloc(4)
  idx.writeUInt32LE(1)
  const base = newCrypt ? hmac(ekpfs, seed) : ekpfs
  const encKey = hmac(base, Buffer.concat([idx, seed]))
  const tweakKey = encKey.subarray(0, 16)
  const dataKey = encKey.subarray(16, 32)
  const outer = Buffer.from(outerPlain)
  for (let s = 16; s < outer.length / 4096; s++) {
    const iv = Buffer.alloc(16)
    iv.writeBigUInt64LE(BigInt(s), 0)
    const c = crypto.createCipheriv('aes-128-xts', Buffer.concat([dataKey, tweakKey]), iv)
    Buffer.concat([c.update(outerPlain.subarray(s * 4096, (s + 1) * 4096)), c.final()]).copy(outer, s * 4096)
  }

  // entradas
  const keysData = Buffer.alloc(32 + 7 * 32 + 7 * 256)
  crypto.randomBytes(keysData.length).copy(keysData)
  const digest1 = crypto.createHash('sha256').update(ekpfs).digest()
  for (let i = 0; i < 32; i++) digest1[i] ^= ekpfs[i]
  digest1.copy(keysData, 32 + 1 * 32)
  const rsaEnc = (data, pub) => crypto.publicEncrypt({ key: pub, padding: crypto.constants.RSA_PKCS1_PADDING }, data)
  rsaEnc(dk3, derived3Keyset.publicKey).copy(keysData, 32 + 7 * 32 + 3 * 256)

  const sfo = buildSfo({ TITLE_ID: contentId.slice(7, 16), TITLE: title, CATEGORY: category, APP_VER: appVer, VERSION: appVer })

  const tableOffset = 0x2000
  const entryDefs = [
    { id: 0x10, data: keysData },
    { id: 0x20, data: null }, // chave da imagem (criptografada)
    { id: 0x1000, data: sfo }
  ]
  let cursor = align(tableOffset + entryDefs.length * 32, 0x100)
  const metas = entryDefs.map((e) => {
    const size = e.id === 0x20 ? 256 : e.data.length
    const meta = { id: e.id, flags1: e.id === 0x20 ? 0x80000000 : 0, flags2: e.id === 0x20 ? 3 << 12 : 0, dataOffset: cursor, dataSize: size }
    cursor = align(cursor + size, 0x10)
    return meta
  })
  const imageKeyMeta = metas[1]
  const wrapKey = newCrypt || true ? rsaEnc(ekpfs, fakeKeyset.publicKey) : null
  const ivKey = crypto.createHash('sha256').update(metaBytes(imageKeyMeta)).update(dk3).digest()
  const cbc = crypto.createCipheriv('aes-128-cbc', ivKey.subarray(16, 32), ivKey.subarray(0, 16))
  cbc.setAutoPadding(false)
  const imageKeyEnc = Buffer.concat([cbc.update(wrapKey), cbc.final()])

  const pfsOffset = align(cursor, 0x10000)
  const file = Buffer.alloc(pfsOffset + outer.length)
  // cabeçalho
  file.writeUInt32BE(0x7f434e54, 0)
  file.writeUInt32BE(0x80000001, 4)
  file.writeUInt32BE(entryDefs.length, 0x10)
  file.writeUInt16BE(0, 0x14)
  file.writeUInt16BE(entryDefs.length, 0x16)
  file.writeUInt32BE(tableOffset, 0x18)
  file.write(contentId, 0x40, 'ascii')
  file.writeUInt32BE(0xf, 0x70)
  file.writeUInt32BE(contentType, 0x74)
  file.writeBigUInt64BE(newCrypt ? 0x2000000000000000n : 0n, 0x408)
  file.writeBigUInt64BE(BigInt(pfsOffset), 0x410)
  file.writeBigUInt64BE(BigInt(outer.length), 0x418)
  metas.forEach((m, i) => metaBytes(m).copy(file, tableOffset + i * 32))
  keysData.copy(file, metas[0].dataOffset)
  imageKeyEnc.copy(file, metas[1].dataOffset)
  sfo.copy(file, metas[2].dataOffset)
  outer.copy(file, pfsOffset)
  return file
}

