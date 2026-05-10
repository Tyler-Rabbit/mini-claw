export interface RequestFrame {
  type: 'req'
  id: string
  method: string
  params: unknown
}

export interface ResponseFrame {
  type: 'res'
  id: string
  ok: boolean
  payload?: unknown
  error?: { message: string; code?: string }
}

export interface EventFrame {
  type: 'event'
  event: string
  payload: unknown
}

type Frame = RequestFrame | ResponseFrame | EventFrame

type EventListener = (payload: unknown) => void

export class GatewayClient {
  private ws: WebSocket | null = null
  private nextId = 1
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private eventListeners = new Map<string, Set<EventListener>>()
  private _connected = false
  private _clientId: string | null = null

  get connected() { return this._connected }
  get clientId() { return this._clientId }

  on(event: string, listener: EventListener) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set())
    }
    this.eventListeners.get(event)!.add(listener)
    return () => this.eventListeners.get(event)?.delete(listener)
  }

  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url)
      this.ws = ws

      ws.onopen = async () => {
        try {
          const res = await this.request('connect', { role: 'client', deviceId: 'web-ui' })
          this._connected = true
          this._clientId = (res as { clientId: string }).clientId
          resolve()
        } catch (e) {
          reject(e)
        }
      }

      ws.onmessage = (ev) => {
        let frame: Frame
        try {
          frame = JSON.parse(ev.data as string) as Frame
        } catch {
          return
        }

        if (frame.type === 'res') {
          const p = this.pending.get(frame.id)
          if (p) {
            this.pending.delete(frame.id)
            if (frame.ok) {
              p.resolve(frame.payload)
            } else {
              p.reject(new Error(frame.error?.message ?? 'Unknown error'))
            }
          }
        } else if (frame.type === 'event') {
          const listeners = this.eventListeners.get(frame.event)
          if (listeners) {
            for (const fn of listeners) fn(frame.payload)
          }
        }
      }

      ws.onclose = () => {
        this._connected = false
        this._clientId = null
        for (const [, p] of this.pending) {
          p.reject(new Error('Connection closed'))
        }
        this.pending.clear()
      }

      ws.onerror = () => {
        reject(new Error('WebSocket connection failed'))
      }
    })
  }

  disconnect() {
    this.ws?.close()
    this.ws = null
    this._connected = false
    this._clientId = null
  }

  request(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected'))
        return
      }
      const id = String(this.nextId++)
      this.pending.set(id, { resolve, reject })
      const frame: RequestFrame = { type: 'req', id, method, params }
      this.ws.send(JSON.stringify(frame))
    })
  }

  sendAgentMessage(message: string, sessionKey = 'default'): Promise<unknown> {
    return this.request('agent', { message, sessionKey })
  }
}
