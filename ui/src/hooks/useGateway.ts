import { useState, useEffect, useRef, useCallback } from 'react'
import { GatewayClient } from '../gateway/client'
import type { ToolCall } from '../components/ChatMessage'

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
  const [streamingToolCalls, setStreamingToolCalls] = useState<ToolCall[]>([])
  const streamBufferRef = useRef('')
  const toolCallsRef = useRef<ToolCall[]>([])
  const currentRunIdRef = useRef<string | null>(null)

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
        currentRunIdRef.current = null
      } else {
        streamBufferRef.current += text
        setStreamingText(streamBufferRef.current)
      }
    })

    client.on('agent:tool_use', (payload) => {
      const { toolName, toolArgs, toolCallId } = payload as {
        toolName: string
        toolArgs: Record<string, unknown>
        toolCallId: string
      }
      const call: ToolCall = { toolName, toolArgs, toolCallId, status: 'running' }
      toolCallsRef.current = [...toolCallsRef.current, call]
      setStreamingToolCalls([...toolCallsRef.current])
    })

    client.on('agent:tool_result', (payload) => {
      const { toolResult, toolCallId } = payload as {
        toolName: string
        toolResult: string
        toolCallId: string
      }
      toolCallsRef.current = toolCallsRef.current.map((tc) =>
        tc.toolCallId === toolCallId
          ? { ...tc, toolResult, status: 'done' as const }
          : tc
      )
      setStreamingToolCalls([...toolCallsRef.current])
    })

    client.on('agent:error', (payload) => {
      const { error } = payload as { runId: string; error: string }
      setIsStreaming(false)
      setStreamingText(`Error: ${error}`)
      currentRunIdRef.current = null
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
    toolCallsRef.current = []
    setStreamingText('')
    setStreamingToolCalls([])
    setIsStreaming(true)
    try {
      const { promise, id } = client.sendAgentMessageWithId(message)
      currentRunIdRef.current = id
      await promise
    } catch (e) {
      setIsStreaming(false)
      setStreamingText(`Error: ${(e as Error).message}`)
    }
  }, [])

  const abort = useCallback(async () => {
    const client = clientRef.current
    if (!client?.connected) return
    // Immediately stop streaming UI
    setIsStreaming(false)
    // Send abort to server
    if (currentRunIdRef.current) {
      try {
        await client.sendAbort(currentRunIdRef.current)
      } catch {
        // Ignore — run may have already finished
      }
    }
    currentRunIdRef.current = null
  }, [])

  useEffect(() => {
    return () => { clientRef.current?.disconnect() }
  }, [])

  return {
    connected, connecting, connect, disconnect, sendMessage, abort,
    streamingText, isStreaming, streamingToolCalls,
  }
}
