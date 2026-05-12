import { useState, useRef, useEffect } from 'react'

interface Props {
  onSend: (message: string) => void
  onStop: () => void
  disabled: boolean
  isStreaming: boolean
}

export function ChatInput({ onSend, onStop, disabled, isStreaming }: Props) {
  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!disabled && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [disabled])

  const handleSend = () => {
    const text = input.trim()
    if (!text || disabled) return
    onSend(text)
    setInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="chat-input">
      <textarea
        ref={textareaRef}
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={disabled ? 'Waiting for response...' : 'Type a message...'}
        disabled={disabled}
        rows={1}
      />
      {isStreaming ? (
        <button className="stop-btn" onClick={onStop}>
          Stop
        </button>
      ) : (
        <button onClick={handleSend} disabled={disabled || !input.trim()}>
          Send
        </button>
      )}
    </div>
  )
}
