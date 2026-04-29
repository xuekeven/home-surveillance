import { useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { statusLabel } from '../shared/status'
import { useViewerRoom } from './useViewerRoom'

export function ViewerPage() {
  const { roomId = 'home' } = useParams()
  const videoRef = useRef<HTMLVideoElement>(null)
  const {
    status,
    error,
    remoteStream,
    socketConnected,
    cameraOnline,
    viewerCount,
    candidateType,
    restart,
    stop
  } = useViewerRoom(roomId)

  useEffect(() => {
    if (videoRef.current && remoteStream) {
      videoRef.current.srcObject = remoteStream
      videoRef.current.muted = false
      void videoRef.current.play().catch(() => {})
    }
  }, [remoteStream])

  return (
    <main className="page">
      <section className="panel">
        <div className="eyebrow">Viewer</div>
        <h1>观看端</h1>
        <p className="muted">房间：{roomId}</p>

        <video
          ref={videoRef}
          className="video"
          playsInline
          autoPlay
          controls
          muted={false}
        />

        <div className="grid">
          <StatusItem label="信令连接" value={socketConnected ? '已连接' : '未连接'} />
          <StatusItem label="采集端在线" value={cameraOnline ? '是' : '否'} />
          <StatusItem label="观看端状态" value={statusLabel(status)} />
          <StatusItem label="房间观看人数" value={`${viewerCount}`} />
          <StatusItem label="ICE 候选路径" value={candidateType || '未知'} />
        </div>

        {error ? <div className="alert">{error}</div> : null}

        <div className="actions">
          <button onClick={() => void restart()}>重新连接</button>
          <button className="secondary" onClick={stop}>停止</button>
        </div>
      </section>
    </main>
  )
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="status-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
