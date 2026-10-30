import { enemyDef } from '../game/enemies.ts'
import type { Enemy } from '../game/types.ts'
import { ENEMY_CARD_CUBE_TRACKS } from './enemy-card-cube-tracks.ts'

const MODE_SLOTS: Readonly<Record<string, readonly number[]>> = {
  guardian_attack: [0, 1],
  guardian_defensive: [2, 3],
  the_champ: [0, 1, 2],
  the_champ_fury: [3, 4, 5],
  downfall_wrathful: [0, 1, 2],
  downfall_wrathful_wrath: [3],
  downfall_blasphemer: [0, 1, 2],
  downfall_blasphemer_divinity: [3],
}

export function enemyCardCube(
  enemy: Pick<Enemy, 'defId' | 'ascension' | 'actionIndex' | 'dead'>,
  imageFile: string,
) {
  if (enemy.dead) return undefined
  const def = enemyDef(enemy.defId, enemy.ascension)
  // Wrath is a single repeating action, printed in its own cube slot on the shared face.
  if (def.pattern.kind !== 'cube' && def.id !== 'downfall_wrathful_wrath') return undefined
  const track = ENEMY_CARD_CUBE_TRACKS[imageFile]
  if (!track) throw new Error(`Missing printed action track: ${imageFile}`)
  const slots = MODE_SLOTS[def.id]
  const slot = slots ? slots[enemy.actionIndex] : enemy.actionIndex
  const square = slot === undefined ? undefined : track[slot]
  if (!square) return undefined
  const [x, y, size] = square
  return { x, y, size, actionIndex: enemy.actionIndex,
    description: `Current action ${enemy.actionIndex + 1} of ${slots?.length ?? track.length}` }
}
