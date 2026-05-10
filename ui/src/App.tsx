import { useState, useRef, useEffect } from 'react'
import { useGateway } from './hooks/useGateway'
import { ConnectionStatus } from './components/ConnectionStatus'
import { ChatMessage, type Message } from './components/ChatMessage'
import { ChatInput } from './components/ChatInput'

const WS_URL = `ws://${window.location.hostname}:18789`

export default function App() {
  const {
    connected, connecting, connect, disconnect, sendMessage,
    streamingText, isStreaming, streamingToolCalls,
  } = useGateway(WS_URL)
  const [messages, setMessages] = useState<Message[]>([])
  const listRef = useRef<HTMLDivElement>(null)
  const msgIdRef = useRef(0)

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages, streamingText, streamingToolCalls])

  const handleSend = (text: string) => {
    const userMsg: Message = {
      id: String(++msgIdRef.current),
      role: 'user',
      content: text,
      toolCalls: [],
      timestamp: Date.now(),
    }
    setMessages(prev => [...prev, userMsg])
    sendMessage(text)
  }

  // When streaming finishes, add the assistant message
  useEffect(() => {
    if (!isStreaming && (streamingText || streamingToolCalls.length > 0)) {
      setMessages(prev => {
        const last = prev[prev.length - 1]
        if (
          last?.role === 'assistant' &&
          last.content === streamingText &&
          last.toolCalls === streamingToolCalls
        ) return prev
        return [...prev, {
          id: String(++msgIdRef.current),
          role: 'assistant' as const,
          content: streamingText,
          toolCalls: streamingToolCalls,
          timestamp: Date.now(),
        }]
      })
    }
  }, [isStreaming, streamingText, streamingToolCalls])

  return (
    <div className="app">
      <header className="header">
        <h1>mini-claw</h1>
        <ConnectionStatus
          connected={connected}
          connecting={connecting}
          onConnect={connect}
          onDisconnect={disconnect}
        />
      </header>

      <main className="chat-list" ref={listRef}>
        {messages.length === 0 && !isStreaming && (
          <div className="empty-state">
            Connect to the gateway and start chatting.
          </div>
        )}
        {messages.map(msg => (
          <ChatMessage key={msg.id} message={msg} />
        ))}
        {isStreaming && (
          <div className="message message-assistant">
            <div className="message-role">Agent</div>
            {streamingToolCalls.length > 0 && (
              <div className="tool-calls">
                {streamingToolCalls.map(tool => (
                  <div
                    key={tool.toolCallId}
                    className={`tool-call ${tool.status === 'running' ? 'tool-call-running' : 'tool-call-done'}`}
                  >
                    <div className="tool-call-header">
                      <span className="tool-call-icon">{tool.status === 'running' ? '⟳' : '✓'}</span>
                      <span className="tool-call-name">{tool.toolName}</span>
                      {tool.status === 'running' && <span className="tool-call-spinner" />}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="message-content">
              {streamingText}
              <span className="cursor" />
            </div>
          </div>
        )}
      </main>

      <footer className="chat-input-container">
        <ChatInput onSend={handleSend} disabled={!connected || isStreaming} />
      </footer>
    </div>
  )
}
