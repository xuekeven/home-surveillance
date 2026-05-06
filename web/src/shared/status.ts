export type ConnectionStatus =
  | 'idle'
  | 'connecting-socket'
  | 'joining-room'
  | 'connecting-media'
  | 'waiting-camera'
  | 'waiting-viewer'
  | 'connecting-webrtc'
  | 'connected'
  | 'disconnected'
  | 'error'

export function statusLabel(status: ConnectionStatus): string {
  const labels: Record<ConnectionStatus, string> = {
    idle: '空闲',
    'connecting-socket': '连接信令中',
    'joining-room': '加入房间中',
    'connecting-media': '开启摄像头中',
    'waiting-camera': '等待采集端',
    'waiting-viewer': '等待观看端',
    'connecting-webrtc': 'WebRTC 连接中',
    connected: '已连接',
    disconnected: '已断开',
    error: '错误'
  }

  return labels[status]
}
