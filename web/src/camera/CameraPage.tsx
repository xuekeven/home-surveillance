import { useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { statusLabel } from '../shared/status'
import { useCameraRoom } from './useCameraRoom'

export function CameraPage() {
  const { roomId = 'home' } = useParams()
  const videoRef = useRef<HTMLVideoElement>(null)
  const {
    status,
    error,
    localStream,
    isSecureContext,
    socketConnected,
    viewers,
    cameraDevices,
    activeCameraId,
    switchingCamera,
    switchCamera,
    restart,
    stop
  } = useCameraRoom(roomId)

  const selectValue = activeCameraId || cameraDevices[0]?.deviceId || ''

  useEffect(() => {
    if (videoRef.current && localStream) {
      videoRef.current.srcObject = localStream
    }
  }, [localStream])

  return (
    <main className="page">
      <section className="panel">
        <div className="eyebrow">Camera</div>
        <h1>采集端</h1>
        <p className="muted">房间：{roomId}</p>

        <video ref={videoRef} className="video" muted playsInline autoPlay />

        {cameraDevices.length > 1 ? (
          <div className="camera-switch">
            <label htmlFor="camera-device">摄像头</label>
            <select
              id="camera-device"
              disabled={switchingCamera}
              value={selectValue}
              onChange={(event) => void switchCamera(event.target.value)}
              aria-busy={switchingCamera}
            >
              {cameraDevices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </option>
              ))}
            </select>
            {switchingCamera ? <span className="muted">切换中…</span> : null}
          </div>
        ) : null}

        <div className="grid">
          <StatusItem label="页面安全上下文" value={isSecureContext ? '是' : '否'} />
          <StatusItem label="信令连接" value={socketConnected ? '已连接' : '未连接'} />
          <StatusItem label="采集端状态" value={statusLabel(status)} />
          <StatusItem label="观看人数" value={`${viewers.length}`} />
        </div>

        {error ? <div className="alert">{error}</div> : null}

        <div className="actions">
          <button onClick={() => void restart()}>重新启动采集</button>
          <button className="secondary" onClick={stop}>停止</button>
        </div>
      </section>

      <section className="panel">
        <h2>观看端连接</h2>
        {viewers.length === 0 ? (
          <p className="muted">暂无观看端，正在等待 viewer 加入。</p>
        ) : (
          <ul className="list">
            {viewers.map((viewer) => (
              <li key={viewer.socketId}>
                <span>{viewer.socketId}</span>
                <strong>{statusLabel(viewer.status)}</strong>
                {viewer.candidateType ? <em>{viewer.candidateType}</em> : null}
              </li>
            ))}
          </ul>
        )}
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
