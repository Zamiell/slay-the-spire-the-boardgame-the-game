/** A failed refresh must not remount the screen and discard uncertain delivery locks. */
export async function resyncCombatOnSuccess(
  refresh: () => Promise<boolean>,
  reset: () => void,
): Promise<void> {
  if (await refresh()) reset()
}
