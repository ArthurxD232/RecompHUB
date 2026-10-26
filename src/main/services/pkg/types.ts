import { PkgInfo } from './pkg'

export interface PkgExtractProgress {
  percent: number
  extractedBytes: number
  totalBytes: number
  currentFile: string
  pkgName: string
  /** Texto pronto para mostrar (o extrator externo não informa bytes, só "arquivo X de Y") */
  detail?: string
}

export interface PkgExtractResult {
  /** PKGs do jogo (base + patches) na ordem em que foram aplicados */
  applied: PkgInfo[]
  /** PKGs deixados de fora por serem variantes opcionais (mods) */
  skipped: PkgInfo[]
  /** PKGs de conteúdo adicional (DLC) e a pasta onde cada um foi extraído */
  addons: { info: PkgInfo; dir: string }[]
  files: number
  bytes: number
}
