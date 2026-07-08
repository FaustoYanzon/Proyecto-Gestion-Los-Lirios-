import AsyncStorage from '@react-native-async-storage/async-storage'

const PREFIX = 'll_rotation_'

interface RotationState {
  idx: number
  ts: number
}

async function readRotation(key: string): Promise<RotationState> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key)
    if (raw) return JSON.parse(raw) as RotationState
  } catch {
    /* non-critical */
  }
  return { idx: -1, ts: 0 }
}

async function writeRotation(key: string, state: RotationState): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFIX + key, JSON.stringify(state))
  } catch {
    /* non-critical */
  }
}

/** Advances the persisted rotation index for `key` by one (mod `length`) and
 * returns the new index. Mirrors frontend/lib/useRotatingIndex.ts so a single
 * notification shows at a time and keeps advancing across app restarts. */
export async function advanceRotation(key: string, length: number): Promise<number> {
  if (length <= 0) return 0
  const state = await readRotation(key)
  const next = (state.idx + 1 + length) % length
  await writeRotation(key, { idx: next, ts: Date.now() })
  return next
}
