import React from 'react'
import {
  Download,
  CheckCircle2,
  AlertCircle,
  Terminal,
  Play,
  X,
  XCircle,
  Trash2
} from 'lucide-react'
import { DownloadTaskProgress } from '../../shared/types'

interface DownloadManagerProps {
  tasks: DownloadTaskProgress[]
  onLaunchGame: (gameId: string) => void
  onCancelDownload?: (taskId: string) => void
  onClearFinished?: () => void
  onClearTask?: (taskId: string) => void
}

function formatSpeed(bps: number): string {
  if (!bps || bps <= 0) return '0 KB/s'
  const mbps = bps / (1024 * 1024)
  if (mbps >= 1) return `${mbps.toFixed(1)} MB/s`
  return `${(bps / 1024).toFixed(0)} KB/s`
}

export const DownloadManager: React.FC<DownloadManagerProps> = ({
  tasks,
  onLaunchGame,
  onCancelDownload,
  onClearFinished,
  onClearTask
}) => {
  const sortedTasks = [...tasks].reverse()
  const activeTask = sortedTasks.find(
    (t) => !['READY_TO_PLAY', 'NEEDS_ROM', 'ERROR', 'CANCELLED'].includes(t.stage)
  )

  const finishedTasks = sortedTasks.filter((t) =>
    ['READY_TO_PLAY', 'NEEDS_ROM', 'ERROR', 'CANCELLED'].includes(t.stage)
  )
  const hasFinishedTasks = finishedTasks.length > 0

  return (
    <div className="min-h-full steam-main-gradient">
      {/* Steam Downloads Top Telemetry Header */}
      <div className="bg-[#121820] border-b border-[#263445] px-8 py-6 flex flex-wrap items-center justify-between gap-6">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-widest text-[#1a9fff]">
            GERENCIADOR DE TRANSFERÊNCIAS E RECEITAS
          </div>
          <h2 className="text-xl font-bold text-white mt-1">
            {activeTask
              ? `${
                  activeTask.stage === 'EXTRACTING_ISO'
                    ? 'Descompactando ISO'
                    : activeTask.stage === 'EXTRACTING_ARCHIVE' ||
                        activeTask.stage === 'APPLYING_RECIPE'
                      ? 'Instalando'
                      : 'Baixando'
                }: ${activeTask.gameTitle}`
              : 'Nenhum download ou instalação em andamento'}
          </h2>
          <p className="text-xs text-[#8f98a0] mt-0.5">
            {activeTask
              ? activeTask.stageLabel
              : 'Downloads concluídos e logs de configuração pós-instalação.'}
          </p>
        </div>

        <div className="flex items-center gap-6 border-l border-[#263445] pl-8 flex-wrap">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#67707b]">
              TAXA ATUAL DE REDE
            </div>
            <div className="text-lg font-mono font-bold text-[#1a9fff]">
              {activeTask ? formatSpeed(activeTask.speedBytesPerSec) : '0 KB/s'}
            </div>
          </div>

          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#67707b]">
              TOTAL NA FILA
            </div>
            <div className="text-lg font-mono font-bold text-white">
              {sortedTasks.length}
            </div>
          </div>

          {/* Botão para limpar informações concluídas */}
          {hasFinishedTasks && onClearFinished && (
            <button
              onClick={onClearFinished}
              className="px-3.5 py-2 bg-[#1b2532] hover:bg-[#28374a] border border-[#2d4158] hover:border-[#406288] rounded-[2px] text-xs font-semibold text-[#c7d5e0] hover:text-white flex items-center gap-2 transition-colors shadow-sm ml-2"
              title="Remover todos os downloads concluídos, cancelados ou com falha da lista"
            >
              <Trash2 className="w-3.5 h-3.5 text-[#8f98a0]" />
              <span>Limpar Concluídos ({finishedTasks.length})</span>
            </button>
          )}
        </div>
      </div>

      {/* Task Queue List */}
      <div className="p-6 max-w-5xl mx-auto space-y-3">
        {sortedTasks.length === 0 ? (
          <div className="p-10 bg-[#16202d] border border-[#263649] rounded-lg text-center space-y-2">
            <Download className="w-6 h-6 text-[#67707b] mx-auto" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#c7d5e0]">
              NENHUMA TAREFA DE DOWNLOAD REGISTRADA
            </h3>
            <p className="text-xs text-[#8f98a0]">
              Quando você instalar um jogo do Catálogo PortsDR ou da Comunidade, o progresso e as receitas aparecerão aqui.
            </p>
          </div>
        ) : (
          sortedTasks.map((task) => {
            const isDone =
              task.stage === 'READY_TO_PLAY' || task.stage === 'NEEDS_ROM'
            const isError = task.stage === 'ERROR'
            const isCancelled = task.stage === 'CANCELLED'
            const isFinished = isDone || isError || isCancelled

            return (
              <div
                key={task.taskId}
                className="p-4 rounded-lg bg-[#16202d] border border-[#263649] space-y-3"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-14 h-10 rounded-md bg-[#0e141b] border border-[#28384a] overflow-hidden shrink-0 flex items-center justify-center">
                      {task.imageUrl ? (
                        <img
                          src={task.imageUrl}
                          alt={task.gameTitle}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-[10px] font-bold text-[#67c1f5]">
                          {task.consoleBadge}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold text-white truncate">
                          {task.gameTitle}
                        </h4>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-[#233242] text-[#67c1f5]">
                          {task.projectName}
                        </span>
                      </div>
                      <p className="text-xs text-[#8f98a0] mt-0.5">
                        {task.stageLabel}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0">
                    {task.stage === 'READY_TO_PLAY' ? (
                      <button
                        onClick={() => onLaunchGame(task.gameId)}
                        className="steam-btn-green px-5 py-1.5 rounded-md text-white text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 shadow"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>JOGAR</span>
                      </button>
                    ) : isCancelled ? (
                      <span className="px-2.5 py-1 rounded-[2px] bg-[#222830] border border-[#3b4452] text-xs font-bold uppercase text-[#8f98a0] flex items-center gap-1.5">
                        <XCircle className="w-3.5 h-3.5 text-[#8f98a0]" />
                        <span>CANCELADO</span>
                      </span>
                    ) : isError ? (
                      <span className="px-2.5 py-1 rounded-[2px] bg-[#341818] border border-[#6b2c2c] text-xs font-bold uppercase text-red-400 flex items-center gap-1.5">
                        <AlertCircle className="w-4 h-4" />
                        <span>FALHA</span>
                      </span>
                    ) : isDone ? (
                      <span className="px-2.5 py-1 rounded-[2px] bg-[#2b2515] border border-[#6b5220] text-xs font-bold uppercase text-[#e5a93c] flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4" />
                        <span>AGUARDANDO ISO</span>
                      </span>
                    ) : (
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-mono font-bold text-[#1a9fff]">
                          {task.overallProgress}%
                        </span>
                        {onCancelDownload && (
                          <button
                            onClick={() => onCancelDownload(task.taskId)}
                            className="px-3 py-1 bg-[#2b1717] hover:bg-[#451f1f] border border-[#6b2c2c] hover:border-red-500 rounded-[2px] text-xs font-bold uppercase tracking-wider text-red-300 hover:text-white flex items-center gap-1 transition-colors shadow-sm"
                            title="Cancelar o download deste jogo"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Cancelar</span>
                          </button>
                        )}
                      </div>
                    )}

                    {/* Botão individual para limpar/remover tarefa concluída */}
                    {isFinished && onClearTask && (
                      <button
                        onClick={() => onClearTask(task.taskId)}
                        className="p-1.5 text-[#6c7885] hover:text-white hover:bg-[#222f3e] rounded-[2px] transition-colors ml-1"
                        title="Remover esta informação da lista"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Steam Progress Bar */}
                <div className="w-full h-2 bg-[#0d141c] rounded-[1px] overflow-hidden border border-[#223040]">
                  <div
                    className={`h-full transition-all duration-200 ${
                      isError
                        ? 'bg-red-500'
                        : isCancelled
                          ? 'bg-[#56606d]'
                          : task.stage === 'READY_TO_PLAY'
                            ? 'bg-[#6cc034]'
                            : 'bg-[#1a9fff]'
                    }`}
                    style={{ width: `${task.overallProgress}%` }}
                  />
                </div>

                {/* Recipe Log Output */}
                {task.logs.length > 0 && (
                  <div className="p-2.5 rounded-md bg-[#0e141b] border border-[#223040] font-mono text-[11px] text-[#8f98a0] max-h-32 overflow-y-auto space-y-0.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[#67c1f5] flex items-center gap-1.5 mb-1">
                      <Terminal className="w-3 h-3" />
                      <span>SAÍDA DA INSTALAÇÃO</span>
                    </div>
                    {task.logs.map((line, idx) => (
                      <div key={idx}>{line}</div>
                    ))}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
