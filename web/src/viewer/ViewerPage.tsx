import { Suspense, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { applyAudioSinkToMedia, useSpeakerOutputSelection } from '../shared/audioSink'
import { CameraDeviceToolbar } from '../shared/cameraDeviceToolbar'
import { SpeakerOutputToolbar } from '../shared/speakerOutputToolbar'
import { FaceAnalysisOverlayLazy } from '../shared/faceAnalysisOverlayLazy'
import { FaceTrackingRadios } from '../shared/faceTrackingRadios'
import { VideoClockOverlay } from '../shared/VideoClockOverlay'
import { statusLabel } from '../shared/status'
import { ROOM_MISSING_MESSAGE } from '../shared/roomJoinMessages'
import { useFamilyMembers } from '../shared/useFamilyMembers'
import { WebRtcStatsPanel } from '../shared/WebRtcStatsPanel'
import { VideoQualityPreferenceToolbar } from '../shared/videoQualityPreference'
import { appConfig } from '../config'
import { useViewerRoom } from './useViewerRoom'

export function ViewerPage() {
  const { roomId = 'home' } = useParams()
  const videoRef = useRef<HTMLVideoElement>(null)
  const {
    status,
    error,
    remoteStream,
    cameraOnline,
    linkStats,
    cameraConnectionType,
    dialogMicOn,
    setDialogMicOn,
    pushMicHeld,
    setPushMicHeld,
    cameraDevices,
    activeCameraId,
    switchingCamera,
    switchRemoteCamera,
    videoQualityPreference,
    setVideoQualityPreference,
    cameraClockSkewMs
  } = useViewerRoom(roomId)

  const voiceReady = status === 'connected'

  const {
    devices: speakerDevices,
    selectedDeviceId: selectedSpeakerId,
    setSelectedDeviceId: setSelectedSpeakerId
  } = useSpeakerOutputSelection()

  const [faceTrackingEnabled, setFaceTrackingEnabled] = useState(false)

  const familyMembersState = useFamilyMembers(appConfig.roomToken, faceTrackingEnabled)

  const roomMissing = error === ROOM_MISSING_MESSAGE

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
        <div className="eyebrow">观看端</div>
        <h1>观看端</h1>
        <p className="muted">房间：{roomId}</p>

        {error ? <div className="alert video-above-alert">{error}</div> : null}

        {!roomMissing ? (
          <>
            <div className="device-controls-block viewer-device-controls">

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

              <VideoQualityPreferenceToolbar
                idPrefix="viewer"
                value={videoQualityPreference}
                disabled={!cameraOnline}
                onChange={setVideoQualityPreference}
              />
            </div>

            <div className="video-face-stack fitted-video-stack">
              <video
                ref={videoRef}
                className="video viewer-remote-video"
                playsInline
                autoPlay
                controls
                muted={false}
              />
              <VideoClockOverlay
                variant="viewer"
                active={Boolean(remoteStream)}
                skewMs={cameraClockSkewMs}
              />
              {Boolean(remoteStream) && faceTrackingEnabled && familyMembersState.ready ? (
                <Suspense fallback={null}>
                  <FaceAnalysisOverlayLazy
                    videoRef={videoRef}
                    active
                    familyMembers={familyMembersState.members}
                  />
                </Suspense>
              ) : null}
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

            <div className="grid viewer-status-grid">
              <StatusItem label="采集端在线" value={cameraOnline ? '是' : '否'} />
              <StatusItem label="观看端状态" value={statusLabel(status)} />
              <StatusItem
                label="对话采集"
                value={dialogMicOn || pushMicHeld ? '开启' : '关闭'}
              />
            </div>

            <WebRtcStatsPanel
              stats={linkStats}
              viewerLayout
              connectionTypeOverride={cameraConnectionType}
            />

          </>
        ) : null}
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
