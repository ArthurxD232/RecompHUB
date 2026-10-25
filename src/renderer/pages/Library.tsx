import React, { useState } from 'react'
import {
  Play,
  Square,
  FolderOpen,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  HardDrive,
  X
} from 'lucide-react'
import {
  CatalogGame,
  InstalledGame,
  UninstallGameOptions
} from '../../shared/types'

interface LibraryProps {
  library: InstalledGame[]
  catalog: CatalogGame[]
  onLaunch: (gameId: string) => void
  onStop: (gameId: string) => void
  onSelectGame: (game: CatalogGame) => void
  onUninstall: (gameId: string, options?: UninstallGameOptions) => Promise<void>
  onGoToCatalog: () => void
}

function formatPlayTime(seconds: number): string {
  if (!seconds || seconds < 60) return 'Menos de 1 min'
  const mins = Math.floor(seconds / 60)
  if (mins < 60) return `${mins} min`
  const hours = (mins / 60).toFixed(1)
  return `${hours} horas`
}

export const Library: React.FC<LibraryProps> = ({
  library,
  catalog,
  onLaunch,
  onStop,
  onSelectGame,
  onUninstall,
  onGoToCatalog
}) => {
  const [confirmGame, setConfirmGame] = useState<InstalledGame | null>(null)
  const [deleteIsoToo, setDeleteIsoToo] = useState(true)
  const [uninstalling, setUninstalling] = useState(false)

  const openGameDetails = (inst: InstalledGame): void => {
    const found = catalog.find(
      (c) => c.id === inst.gameId || c.ports?.some((p) => p.id === inst.gameId)
    )
    if (found) {
      onSelectGame({
        ...found,
        selectedPortId: inst.gameId
      })
    }
  }

  const handleConfirmUninstall = async (): Promise<void> => {
    if (!confirmGame) return
    setUninstalling(true)
    try {
      await onUninstall(confirmGame.gameId, {
        deleteRomFromVault: deleteIsoToo,
        deleteOriginalArchive: false
      })
      setConfirmGame(null)
    } finally {
      setUninstalling(false)
    }
  }

  return (
    <div className="min-h-full steam-main-gradient p-6 space-y-5">
      <div className="border-b border-[#2a3846] pb-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-white">
            JOGOS INSTALADOS
          </h2>
          <span className="text-xs font-mono text-[#67c1f5]">
            ({library.length})
          </span>
        </div>
      </div>

      {library.length === 0 ? (
        <div className="p-10 bg-[#16202d] border border-[#263649] rounded-lg text-center space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-wide text-white">
            NENHUM JOGO INSTALADO NA BIBLIOTECA
          </h3>
          <p className="text-xs text-[#8f98a0] max-w-md mx-auto">
            Selecione um jogo na barra lateral ou no Catálogo PortsDR para instalar o port e vincular sua ISO/ROM local.
          </p>
          <button
            onClick={onGoToCatalog}
            className="steam-btn-blue px-5 py-2 rounded-md text-white text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 shadow"
          >
            <span>IR PARA O CATÁLOGO PORTSDR</span>
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {library.map((inst) => (
            <div
              key={inst.id}
              onClick={() => openGameDetails(inst)}
              className="bg-[#16202d] hover:bg-[#1e2c3d] border border-[#263649] hover:border-[#3e5875] rounded-lg p-3.5 flex flex-wrap items-center justify-between gap-4 cursor-pointer transition-colors"
            >
              <div className="flex items-center gap-4 min-w-0">
                <div className="w-16 h-12 rounded-md bg-[#0e141b] border border-[#28384a] overflow-hidden shrink-0 flex items-center justify-center">
                  {inst.imageUrl ? (
                    <img
                      src={inst.imageUrl}
                      alt={inst.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-[11px] font-bold text-[#67c1f5]">
                      {inst.consoleBadge}
                    </span>
                  )}
                </div>

                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="px-1.5 py-0.5 bg-[#233242] text-[#67c1f5] text-[10px] font-bold uppercase rounded-md">
                      {inst.consoleBadge}
                    </span>
                    <h3 className="text-sm font-bold text-white truncate">
                      {inst.title}
                    </h3>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 mt-1 text-[11px] text-[#8f98a0]">
                    <span>
                      Projeto: {inst.projectName} ({inst.version})
                    </span>
                    <span>•</span>
                    {inst.status === 'READY_TO_PLAY' ||
                    inst.status === 'RUNNING' ? (
                      <span className="text-[#6cc034] flex items-center gap-1 font-medium">
                        <CheckCircle2 className="w-3 h-3" /> ISO/ROM Pareada
                      </span>
                    ) : (
                      <span className="text-[#e5a93c] flex items-center gap-1 font-medium">
                        <AlertTriangle className="w-3 h-3" /> Selecionar ISO/ROM
                      </span>
                    )}
                    {inst.requiresCompatibilityLayer && (
                      <>
                        <span>•</span>
                        <span className="text-[#67c1f5]">Proton / umu-run</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div
                className="flex items-center gap-4"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="text-right hidden sm:block">
                  <div className="text-[10px] uppercase font-bold text-[#67707b]">
                    TEMPO DE JOGO
                  </div>
                  <div className="text-xs text-[#c7d5e0] flex items-center gap-1 justify-end">
                    <Clock className="w-3 h-3 text-[#67707b]" />
                    <span>{formatPlayTime(inst.playTimeSeconds)}</span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => window.api.openGameFolder(inst.gameId)}
                    title="Abrir pasta de instalação"
                    className="p-2 rounded-md bg-[#243242] hover:bg-[#314357] border border-[#34475c] text-[#c7d5e0]"
                  >
                    <FolderOpen className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => {
                      setDeleteIsoToo(true)
                      setConfirmGame(inst)
                    }}
                    title="Desinstalar jogo e/ou ISO"
                    className="p-2 rounded-md bg-[#243242] hover:bg-[#7a2828] border border-[#34475c] text-[#c7d5e0] hover:text-white"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>

                  {inst.status === 'RUNNING' ? (
                    <button
                      onClick={() => onStop(inst.gameId)}
                      className="px-5 py-2 rounded-md bg-[#c93838] hover:bg-[#e04343] text-white text-xs font-bold uppercase tracking-wider flex items-center gap-1.5"
                    >
                      <Square className="w-3.5 h-3.5 fill-current" />
                      <span>PARAR</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        if (inst.status === 'NEEDS_ROM') {
                          openGameDetails(inst)
                        } else {
                          onLaunch(inst.gameId)
                        }
                      }}
                      className={`px-6 py-2 rounded-md text-white text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 shadow ${
                        inst.status === 'NEEDS_ROM'
                          ? 'bg-[#b87d14] hover:bg-[#cf8e19]'
                          : 'steam-btn-green'
                      }`}
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>
                        {inst.status === 'NEEDS_ROM' ? 'VINCULAR ISO' : 'JOGAR'}
                      </span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Steam Uninstall Confirmation Modal */}
      {confirmGame && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#1b2838] border border-[#354c66] rounded-lg shadow-2xl overflow-hidden">
            <div className="px-5 py-3.5 bg-[#171d25] border-b border-[#2a3846] flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                <Trash2 className="w-4 h-4 text-red-400" />
                <span>DESINSTALAR — {confirmGame.title}</span>
              </div>
              <button
                onClick={() => setConfirmGame(null)}
                className="text-[#8f98a0] hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs text-[#c7d5e0]">
              <p className="leading-relaxed">
                Tem certeza que deseja desinstalar{' '}
                <strong className="text-white">{confirmGame.title}</strong>?
                Isso removerá os executáveis e arquivos do port instalado.
              </p>

              <label className="p-3 rounded-md bg-[#131c27] border border-[#2a3c52] flex items-start gap-3 cursor-pointer select-none hover:border-[#416082]">
                <input
                  type="checkbox"
                  checked={deleteIsoToo}
                  onChange={(e) => setDeleteIsoToo(e.target.checked)}
                  className="mt-0.5 accent-[#1a9fff]"
                />
                <div className="space-y-1">
                  <div className="font-bold text-white flex items-center gap-1.5">
                    <HardDrive className="w-3.5 h-3.5 text-[#67c1f5]" />
                    <span>Excluir também a ISO / ROM vinculada do computador</span>
                  </div>
                  <p className="text-[11px] text-[#8f98a0] leading-relaxed">
                    Remove a ISO/ROM extraída armazenada no Cofre do RecompHUB para liberar todo o espaço em disco ocupado pelo jogo.
                  </p>
                </div>
              </label>

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#263649]">
                <button
                  onClick={() => setConfirmGame(null)}
                  disabled={uninstalling}
                  className="px-4 py-2 rounded-md bg-[#2a3846] hover:bg-[#37495b] text-xs font-bold uppercase tracking-wider text-[#dcdedf]"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleConfirmUninstall}
                  disabled={uninstalling}
                  className="px-5 py-2 rounded-md bg-[#b83232] hover:bg-[#d43b3b] text-xs font-bold uppercase tracking-wider text-white shadow"
                >
                  {uninstalling ? 'Excluindo...' : 'Confirmar Exclusão'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
