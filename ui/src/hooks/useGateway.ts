import { useState, useEffect, useRef, useCallback } from 'react'
import { GatewayClient } from '../gateway/client'

export interface StreamChunk {
  runId: string
  text: string
  done: boolean
}

export function useGateway(url: string) {
  const clientRef = useRef<GatewayClient | null>(null)
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const streamBufferRef = useRef('')

  const connect = useCallback(async () => {
    if (clientRef.current?.connected) return
    setConnecting(true)
    const client = new GatewayClient()
    clientRef.current = client

    client.on('agent:stream', (payload) => {
      const { text, done } = payload as StreamChunk
      if (done) {
        setIsStreaming(false)
        setStreamingText(streamBufferRef.current)
      } else {
        streamBufferRef.current += text
        setStreamingText(streamBufferRef.current)
      }
    })

    client.on('agent:error', (payload) => {
      const { error } = payload as { runId: string; error: string }
      setIsStreaming(false)
      setStreamingText(`Error: ${error}`)
    })

    try {
      await client.connect(url)
      setConnected(true)
    } catch {
      setConnected(false)
    } finally {
      setConnecting(false)
    }
  }, [url])

  const disconnect = useCallback(() => {
    clientRef.current?.disconnect()
    clientRef.current = null
    setConnected(false)
  }, [])

  const sendMessage = useCallback(async (message: string) => {
    const client = clientRef.current
    if (!client?.connected) return
    streamBufferRef.current = ''
    setStreamingText('')
    setIsStreaming(true)
    try {
      await client.sendAgentMessage(message)
    } catch (e) {
      setIsStreaming(false)
      setStreamingText(`Error: ${(e as Error).message}`)
    }
  }, [])

  useEffect(() => {
    return () => { clientRef.current?.disconnect() }
  }, [])

  return { connected, connecting, connect, disconnect, sendMessage, streamingText, isStreaming }
}
