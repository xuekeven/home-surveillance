import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { applyAudioSinkToMedia, useSpeakerOutputSelection } from '../shared/audioSink'
import { CameraDeviceToolbar } from '../shared/cameraDeviceToolbar'
import { SpeakerOutputToolbar } from '../shared/speakerOutputToolbar'
import { FaceAnalysisOverlay } from '../shared/faceAnalysisOverlay'
import { FaceTrackingRadios } from '../shared/faceTrackingRadios'
import { statusLabel } from '../shared/status'
import { appConfig } from '../config'
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
    dialogMicOn,
    setDialogMicOn,
    pushMicHeld,
    setPushMicHeld,
    cameraDevices,
    activeCameraId,
    switchingCamera,
    switchRemoteCamera,
    restart,
    stop
  } = useViewerRoom(roomId)

  const voiceReady = status === 'connected'

  const {
    devices: speakerDevices,
    selectedDeviceId: selectedSpeakerId,
    setSelectedDeviceId: setSelectedSpeakerId
  } = useSpeakerOutputSelection()

  const [faceTrackingEnabled, setFaceTrackingEnabled] = useState(true)

  useEffect(() => {
    if (videoRef.current && remoteStream) {
      videoRef.current.srcObject = remoteStream
      videoRef.current.muted = false
      void videoRef.current.play().catch(() => {})
    }
  }, [remoteStream])

  useEffect(() => {
    const el = videoRef.current
    if (!el || !remoteStream) {
      return
    }
    void applyAudioSinkToMedia(el, selectedSpeakerId)
  }, [remoteStream, selectedSpeakerId])

  return (
    <main className="page">
      <section className="panel">
        <div className="eyebrow">Viewer</div>
        <h1>观看端</h1>
        <p className="muted">房间：{roomId}</p>

        <div className="video-face-stack">
          <video
            ref={videoRef}
            className="video viewer-remote-video"
            playsInline
            autoPlay
            controls
            muted={false}
          />
          <FaceAnalysisOverlay
            videoRef={videoRef}
            active={Boolean(remoteStream) && faceTrackingEnabled}
            faceAlert={{
              roomId,
              token: appConfig.roomToken,
              enabled: faceTrackingEnabled && Boolean(remoteStream)
            }}
          />
        </div>

        <div className="grid">
          <StatusItem label="信令连接" value={socketConnected ? '已连接' : '未连接'} />
          <StatusItem label="采集端在线" value={cameraOnline ? '是' : '否'} />
          <StatusItem label="观看端状态" value={statusLabel(status)} />
          <StatusItem label="房间观看人数" value={`${viewerCount}`} />
          <StatusItem label="ICE 候选路径" value={candidateType || '未知'} />
          <StatusItem
            label="对话采集"
            value={dialogMicOn || pushMicHeld ? '开启' : '关闭'}
          />
        </div>

        <div className="device-controls-block">
          <CameraDeviceToolbar
            idPrefix="viewer"
            label="采集摄像头"
            devices={cameraDevices}
            activeCameraId={activeCameraId}
            switchingCamera={switchingCamera}
            onSelectDevice={(deviceId) => switchRemoteCamera(deviceId)}
          />

          <SpeakerOutputToolbar
            idPrefix="viewer"
            devices={speakerDevices}
            selectedDeviceId={selectedSpeakerId}
            onSelectDevice={setSelectedSpeakerId}
          />

          <FaceTrackingRadios
            idPrefix="viewer"
            enabled={faceTrackingEnabled}
            onChange={setFaceTrackingEnabled}
          />
        </div>

        <div className="viewer-voice">
          <button
            type="button"
            className={`speak-btn${pushMicHeld ? ' active' : ''}`}
            disabled={!voiceReady || dialogMicOn}
            onPointerDown={(event) => {
              event.preventDefault()
              if (!voiceReady || dialogMicOn) {
                return
              }
              setPushMicHeld(true)
            }}
            onPointerUp={() => setPushMicHeld(false)}
            onPointerLeave={() => setPushMicHeld(false)}
            onPointerCancel={() => setPushMicHeld(false)}
          >
            按住说话
          </button>
          <button
            type="button"
            className="secondary"
            disabled={!voiceReady}
            onClick={() => setDialogMicOn((prev) => !prev)}
          >
            {dialogMicOn ? '关闭对话' : '开启对话'}
          </button>
        </div>
        {!voiceReady ? (
          <p className="muted viewer-voice-hint">与采集端建立 WebRTC 连接后可使用对讲。</p>
        ) : null}

        {error ? <div className="alert">{error}</div> : null}

        <div className="actions">
          <button onClick={() => void restart()}>重新连接</button>
          <button className="secondary" onClick={stop}>停止连接</button>
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
