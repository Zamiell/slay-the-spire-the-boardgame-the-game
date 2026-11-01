class RoomError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message)
    this.name = 'RoomError'
  }
}

/** @param {string} message @returns {never} */
export function fail(message) {
  throw new RoomError(message)
}
