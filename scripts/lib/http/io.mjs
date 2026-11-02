const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
}

export const MAX_BODY = 64 * 1024

export function send(response, status, body) {
  response.writeHead(status, JSON_HEADERS)
  response.end(JSON.stringify(body))
  return true
}

export async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY) throw Object.assign(new Error('Request body is too large'), { status: 413 })
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error('JSON body must be an object')
    return body
  } catch {
    throw Object.assign(new Error('JSON body must be an object'), { status: 400 })
  }
}

export const sourceOf = (request) => request.headers['cf-connecting-ip']?.toString()
  ?? request.socket.remoteAddress
  ?? 'unknown'

export function networkOf(source) {
  // A dual-stack socket reports IPv4 clients as ::ffff:a.b.c.d.
  if (source.toLowerCase().startsWith('::ffff:')) source = source.slice(7)
  if (!source.includes(':') || source.includes('.')) return source
  const [head, tail] = source.split('::')
  const before = head ? head.split(':') : []
  const after = tail ? tail.split(':') : []
  const groups = tail === undefined ? before : [...before, ...Array(Math.max(0, 8 - before.length - after.length)).fill('0'), ...after]
  return groups.slice(0, 4).map((group) => Number.parseInt(group, 16).toString(16)).join(':')
}
