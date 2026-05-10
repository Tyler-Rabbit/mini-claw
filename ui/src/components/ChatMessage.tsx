import { useState } from 'react'

export interface ToolCall {
  toolName: string
  toolArgs?: Record<string, unknown>
  toolResult?: string
  toolCallId: string
  status: 'running' | 'done'
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls: ToolCall[]
  timestamp: number
}

function ToolCallBlock({ tool }: { tool: ToolCall }) {
  const [expanded, setExpanded] = useState(tool.status === 'running')
  const argsStr = tool.toolArgs ? JSON.stringify(tool.toolArgs, null, 2) : ''

  return (
    <div className={`tool-call ${tool.status === 'running' ? 'tool-call-running' : 'tool-call-done'}`}>
      <div className="tool-call-header" onClick={() => setExpanded(!expanded)}>
        <span className="tool-call-icon">{tool.status === 'running' ? '⟳' : '✓'}</span>
        <span className="tool-call-name">{tool.toolName}</span>
        {!expanded && argsStr && (
          <span className="tool-call-preview">
            {argsStr.length > 60 ? argsStr.slice(0, 60) + '...' : argsStr}
          </span>
        )}
        <span className="tool-call-toggle">{expanded ? '▾' : '▸'}</span>
      </div>
      {expanded && (
        <div className="tool-call-body">
          {argsStr && (
            <div className="tool-call-section">
              <div className="tool-call-label">Arguments</div>
              <pre className="tool-call-code">{argsStr}</pre>
            </div>
          )}
          {tool.toolResult && (
            <div className="tool-call-section">
              <div className="tool-call-label">Result</div>
              <pre className="tool-call-code">{tool.toolResult}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function ChatMessage({ message }: { message: Message }) {
  const isUser = message.role === 'user'
  return (
    <div className={`message ${isUser ? 'message-user' : 'message-assistant'}`}>
      <div className="message-role">{isUser ? 'You' : 'Agent'}</div>
      {message.toolCalls.length > 0 && (
        <div className="tool-calls">
          {message.toolCalls.map((tool) => (
            <ToolCallBlock key={tool.toolCallId} tool={tool} />
          ))}
        </div>
      )}
      {message.content && (
        <div className="message-content">{message.content}</div>
      )}
    </div>
  )
}
