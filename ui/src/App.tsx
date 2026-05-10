import { useState, useRef, useEffect } from 'react'
import { useGateway } from './hooks/useGateway'
import { ConnectionStatus } from './components/ConnectionStatus'
import { ChatMessage, type Message } from './components/ChatMessage'
import { ChatInput } from './components/ChatInput'

const WS_URL = `ws://${window.location.hostname}:18789`

export default function App() {
  const { connected, connecting, connect, disconnect, sendMessage, streamingText, isStreaming } = useGateway(WS_URL)
  const [messages, setMessages] = useState<Message[]>([])
  const listRef = useRef<HTMLDivElement>(null)
  const msgIdRef = useRef(0)

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages, streamingText])

  const handleSend = (text: string) => {
    const userMsg: Message = {
      id: String(++msgIdRef.current),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    }
    setMessages(prev => [...prev, userMsg])
    sendMessage(text)
  }

  // When streaming finishes, add the assistant message
  useEffect(() => {
    if (!isStreaming && streamingText) {
      setMessages(prev => {
        // Avoid duplicates: only add if the last assistant message differs
        const last = prev[prev.length - 1]
        if (last?.role === 'assistant' && last.content === streamingText) return prev
        return [...prev, {
          id: String(++msgIdRef.current),
          role: 'assistant' as const,
          content: streamingText,
          timestamp: Date.now(),
        }]
      })
    }
  }, [isStreaming, streamingText])

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
