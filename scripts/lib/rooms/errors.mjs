class RoomError extends Error {
  constructor(message) {
    super(message)
    this.name = 'RoomError'
  }
}

export function fail(message) {
  throw new RoomError(message)
}
