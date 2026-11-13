/**
 * The Jupyter messaging protocol (version 5.3) on the wire: each message is a multipart ZeroMQ
 * message of routing identities, the delimiter, an HMAC-SHA256 signature over the four JSON
 * frames, then header, parent header, metadata, content, and any binary buffers.
 * https://jupyter-client.readthedocs.io/en/stable/messaging.html#the-wire-protocol
 */
import { createHmac, randomUUID, timingSafeEqual } from 'crypto'

export const DELIMITER = '<IDS|MSG>'
export const PROTOCOL_VERSION = '5.3'

export interface Header {
  msg_id: string
  session: string
  username: string
  date: string
  msg_type: string
  version: string
}

export interface Message<C = Record<string, unknown>> {
  header: Header
  parent_header: Partial<Header>
  metadata: Record<string, unknown>
  content: C
  buffers?: Buffer[]
}

export function sign(key: string, frames: (string | Buffer)[]): string {
  if (!key) return ''
  const h = createHmac('sha256', key)
  for (const f of frames) h.update(f)
  return h.digest('hex')
}

export function makeMessage<C extends object>(msg_type: string, content: C, session: string, parent: Partial<Header> = {}, metadata: Record<string, unknown> = {}): Message<C> {
  return {
    header: { msg_id: randomUUID(), session, username: 'tide', date: new Date().toISOString(), msg_type, version: PROTOCOL_VERSION },
    parent_header: parent,
    metadata,
    content
  }
}

export function encode(msg: Message<object>, key: string, identities: Buffer[] = []): (Buffer | string)[] {
  const parts = [JSON.stringify(msg.header), JSON.stringify(msg.parent_header), JSON.stringify(msg.metadata), JSON.stringify(msg.content)]
  return [...identities, DELIMITER, sign(key, parts), ...parts, ...(msg.buffers ?? [])]
}

/** A received multipart message, its signature checked; null when it's malformed or the signature is wrong */
export function decode(frames: Buffer[], key: string): (Message & { identities: Buffer[] }) | null {
  const at = frames.findIndex((f) => f.toString() === DELIMITER)
  if (at < 0 || frames.length < at + 6) return null
  const [sig, header, parent, meta, content] = frames.slice(at + 1, at + 6)
  if (key) {
    const want = Buffer.from(sign(key, [header, parent, meta, content]))
    const got = Buffer.from(sig.toString())
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null
  }
  try {
    return {
      identities: frames.slice(0, at),
      header: JSON.parse(header.toString()),
      parent_header: JSON.parse(parent.toString()),
      metadata: JSON.parse(meta.toString()),
      content: JSON.parse(content.toString()),
      buffers: frames.slice(at + 6)
    }
  } catch {
    return null
  }
}

export interface ConnectionInfo {
  ip: string
  transport: 'tcp'
  shell_port: number
  iopub_port: number
  stdin_port: number
  control_port: number
  hb_port: number
  key: string
  signature_scheme: 'hmac-sha256'
  kernel_name: string
}
