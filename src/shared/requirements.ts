import { RomRequirement } from './types'

export const PATCH_REQUIREMENT_ID = 'patches'

export function genericIsoRequirement(
  gameId: string,
  title: string,
  optional = false
): RomRequirement {
  return {
    id: `${gameId}_rom`,
    label: `${title} — ISO / ROM Original${optional ? ' (opcional)' : ''}`,
    type: 'iso',
    expectedFilename: 'game.iso',
    extensions: ['.iso', '.bin', '.z64', '.n64', '.rom'],
    optional
  }
}

/**
 * Espaço opcional para patches, atualizações e DLC. Todo jogo ganha um: os arquivos escolhidos
 * ficam guardados no cofre por referência (sem copiar) e são vinculados à pasta do jogo.
 */
export function patchRequirement(): RomRequirement {
  return {
    id: PATCH_REQUIREMENT_ID,
    label: 'Patches, atualizações e DLC (opcional)',
    type: 'patch',
    expectedFilename: '',
    extensions: [],
    optional: true,
    multiple: true,
    targetSubdir: 'patches'
  }
}

export function withPatchRequirement(requirements: RomRequirement[]): RomRequirement[] {
  return requirements.some((r) => r.type === 'patch')
    ? requirements
    : [...requirements, patchRequirement()]
}
