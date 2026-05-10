interface Props {
  connected: boolean
  connecting: boolean
  onConnect: () => void
  onDisconnect: () => void
}

export function ConnectionStatus({ connected, connecting, onConnect, onDisconnect }: Props) {
  return (
    <div className="connection-status">
      <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`} />
      <span className="status-text">
        {connecting ? 'Connecting...' : connected ? 'Connected' : 'Disconnected'}
      </span>
      {connected ? (
        <button onClick={onDisconnect}>Disconnect</button>
      ) : (
        <button onClick={onConnect} disabled={connecting}>Connect</button>
      )}
    </div>
  )
}
