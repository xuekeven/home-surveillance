import { Suspense, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { applyAudioSinkToMedia, useSpeakerOutputSelection } from '../shared/audioSink'
import { CameraDeviceToolbar } from '../shared/cameraDeviceToolbar'
import { SpeakerOutputToolbar } from '../shared/speakerOutputToolbar'
import { FaceAnalysisOverlayLazy } from '../shared/faceAnalysisOverlayLazy'
import { VideoClockOverlay } from '../shared/VideoClockOverlay'
import { statusLabel } from '../shared/status'
import { ROOM_MISSING_MESSAGE } from '../shared/roomJoinMessages'
import { useFamilyMembers } from '../shared/useFamilyMembers'
import { useRoomStrangerAlert } from '../shared/useRoomStrangerAlert'
import { appConfig } from '../config'
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
    viewerInboundAudio,
    cameraDevices,
    activeCameraId,
    switchingCamera,
    switchCamera,
    restart,
    stop
  } = useCameraRoom(roomId)

  const {
    devices: speakerDevices,
    selectedDeviceId: selectedSpeakerId,
    setSelectedDeviceId: setSelectedSpeakerId
  } = useSpeakerOutputSelection()

  const strangerFaceAlertOn = useRoomStrangerAlert(appConfig.roomToken, roomId)
  const familyMembers = useFamilyMembers(appConfig.roomToken, strangerFaceAlertOn)

  const hideCameraUi = error === ROOM_MISSING_MESSAGE

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

        {error ? <div className="alert video-above-alert">{error}</div> : null}

        {!hideCameraUi ? (
          <div className="video-face-stack">
            <video ref={videoRef} className="video" muted playsInline autoPlay />
            <VideoClockOverlay variant="camera" active={Boolean(localStream)} />
            {Boolean(localStream) && strangerFaceAlertOn ? (
              <Suspense fallback={null}>
                <FaceAnalysisOverlayLazy
                  videoRef={videoRef}
                  active
                  showStrangerOverlay={false}
                  familyMembers={familyMembers}
                  faceAlert={{
                    roomId,
                    token: appConfig.roomToken,
                    enabled: strangerFaceAlertOn
                  }}
                />
              </Suspense>
            ) : null}
          </div>
        ) : null}

        {!hideCameraUi ? (
          <>
            <div className="grid">
              <StatusItem label="页面安全上下文" value={isSecureContext ? '是' : '否'} />
              <StatusItem label="信令连接" value={socketConnected ? '已连接' : '未连接'} />
              <StatusItem label="采集端状态" value={statusLabel(status)} />
              <StatusItem label="正在观看" value={`${viewers.length}`} />
              <StatusItem
                label="麦克风"
                value={localStream?.getAudioTracks().some((t) => t.readyState === 'live') ? '已采集' : '未采集'}
              />
            </div>

            <div className="device-controls-block">
              <CameraDeviceToolbar
                idPrefix="camera"
                devices={cameraDevices}
                activeCameraId={activeCameraId}
                switchingCamera={switchingCamera}
                onSelectDevice={(deviceId) => void switchCamera(deviceId)}
              />

              <SpeakerOutputToolbar
                idPrefix="camera"
                devices={speakerDevices}
                selectedDeviceId={selectedSpeakerId}
                onSelectDevice={setSelectedSpeakerId}
              />

            </div>

            <div className="actions">
              <button onClick={() => void restart()}>重新启动采集</button>
              <button className="secondary" onClick={stop}>停止当前采集</button>
            </div>
          </>
        ) : null}
      </section>

      {!hideCameraUi ? (
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
                  {viewerInboundAudio[viewer.socketId] ? (
                    <em className="viewer-return-audio">对讲上行</em>
                  ) : null}
                  {viewer.candidateType ? <em>{viewer.candidateType}</em> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {!hideCameraUi ? (
        <div className="viewer-remote-audios" aria-hidden="true">
          {Object.entries(viewerInboundAudio).map(([viewerSocketId, stream]) => (
            <ViewerRemoteAudioTrack
              key={viewerSocketId}
              stream={stream}
              outputDeviceId={selectedSpeakerId}
            />
          ))}
        </div>
      ) : null}
    </main>
  )
}

function ViewerRemoteAudioTrack({
  stream,
  outputDeviceId
}: {
  stream: MediaStream
  outputDeviceId: string
}) {
  const ref = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) {
      return
    }
    el.srcObject = stream
    void el.play().catch(() => {})
    void applyAudioSinkToMedia(el, outputDeviceId)
  }, [stream, outputDeviceId])

  return <audio ref={ref} autoPlay playsInline />
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="status-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
