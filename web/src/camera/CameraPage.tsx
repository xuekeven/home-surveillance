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
import { WebRtcStatsPanel } from '../shared/WebRtcStatsPanel'
import { appConfig } from '../config'
import { useCameraRoom } from './useCameraRoom'

function formatCaptureQuality(settings: MediaTrackSettings | undefined): string {
  if (!settings?.width || !settings.height) return '--'
  const frames = settings.frameRate ? ' 帧数 ' + Math.round(settings.frameRate) : ''
  return '像素 ' + settings.width + '×' + settings.height + frames
}

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
    switchCamera
  } = useCameraRoom(roomId)

  const {
    devices: speakerDevices,
    selectedDeviceId: selectedSpeakerId,
    setSelectedDeviceId: setSelectedSpeakerId
  } = useSpeakerOutputSelection()

  const strangerFaceAlertOn = useRoomStrangerAlert(appConfig.roomToken, roomId)
  const familyMembersState = useFamilyMembers(appConfig.roomToken, strangerFaceAlertOn)

  const hideCameraUi = error === ROOM_MISSING_MESSAGE
  const captureSettings = localStream?.getVideoTracks()[0]?.getSettings()

  useEffect(() => {
    if (videoRef.current && localStream) {
      videoRef.current.srcObject = localStream
    }
  }, [localStream])

  return (
    <main className="page">
      <section className="panel">
        <div className="eyebrow">采集端</div>
        <h1>采集端</h1>
        <p className="muted">房间：{roomId}</p>

        {error ? <div className="alert video-above-alert">{error}</div> : null}

        {!hideCameraUi ? (
          <div className="device-controls-block camera-device-controls">
            <CameraDeviceToolbar
              idPrefix="camera"
              label="本端摄像头"
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
        ) : null}

        {!hideCameraUi ? (
          <div className="video-face-stack fitted-video-stack">
            <video ref={videoRef} className="video" muted playsInline autoPlay />
            <VideoClockOverlay variant="camera" active={Boolean(localStream)} />
            {Boolean(localStream) && strangerFaceAlertOn && familyMembersState.ready ? (
              <Suspense fallback={null}>
                <FaceAnalysisOverlayLazy
                  videoRef={videoRef}
                  active
                  showStrangerOverlay={false}
                  familyMembers={familyMembersState.members}
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
            <div className="grid camera-status-grid">
              <StatusItem label="页面安全上下文" value={isSecureContext ? '是' : '否'} />
              <StatusItem label="信令连接" value={socketConnected ? '已连接' : '未连接'} />
              <StatusItem label="采集端状态" value={statusLabel(status)} />
              <StatusItem
                label="麦克风"
                value={localStream?.getAudioTracks().some((t) => t.readyState === 'live') ? '已采集' : '未采集'}
              />
              <StatusItem label="本地采集画质" value={formatCaptureQuality(captureSettings)} />
            </div>

          </>
        ) : null}
      </section>

      {!hideCameraUi ? (
        <section className="panel">
          <h2>观看端连接</h2>
          {viewers.length === 0 ? (
            <p className="muted">暂无观看端，正在等待观看端加入。</p>
          ) : (
            <ul className="list">
              {viewers.map((viewer, index) => {
                const duplicateNumber = viewer.deviceName
                  ? viewers.slice(0, index + 1).filter((item) => item.deviceName === viewer.deviceName).length
                  : 1
                const duplicateCount = viewer.deviceName
                  ? viewers.filter((item) => item.deviceName === viewer.deviceName).length
                  : 0
                const displayName = viewer.deviceName
                  ? `${viewer.deviceName}${duplicateCount > 1 ? `（${duplicateNumber}）` : ''}`
                  : `观看端 ${index + 1}`

                return (
                <li key={viewer.socketId} className="viewer-link-item">
                  <div className="viewer-link-summary">
                    <span>{displayName}</span>
                    <strong>{statusLabel(viewer.status)}</strong>
                    {viewerInboundAudio[viewer.socketId] ? (
                      <em className="viewer-return-audio">对讲上行</em>
                    ) : null}
                  </div>
                  <WebRtcStatsPanel
                    stats={viewer.linkStats}
                    viewerLayout
                    localAddressLabel="采集端连接 IP"
                  />
                </li>
                )
              })}
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
