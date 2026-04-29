import { useCallback, useEffect, useRef, useState } from 'react'
import type SimplePeer from 'simple-peer'
import type { Socket } from 'socket.io-client'
import { appConfig, type IceServer } from '../config'
import {
  createSocket,
  formatSocketConnectError,
  SOCKET_HANDSHAKE_STALL_HINT
} from '../shared/socket'
import type { ConnectionStatus } from '../shared/status'
import {
  assertWebRtcSupport,
  createCameraPeer,
  detectSelectedCandidateType,
  getCameraCaptureStream,
  getCameraVideoMediaStreamByDeviceId,
  getIceServers,
  isBenignPeerTeardownError,
  listVideoInputDevices,
  replaceOutgoingVideoTrackForPeers,
  type PeerInstance
} from '../shared/rtc'

interface ViewerInfo {
  socketId: string
  status: ConnectionStatus
  candidateType?: string
}

interface SignalMessage {
  from: string
  signal: SimplePeer.SignalData
}

interface ViewerJoinedMessage {
  viewerSocketId: string
}

interface ViewerLeftMessage {
  viewerSocketId: string
}

interface RoomErrorMessage {
  message: string
}

export interface CameraDeviceOption {
  deviceId: string
  label: string
}

export function useCameraRoom(roomId: string) {
  const [status, setStatus] = useState<ConnectionStatus>('idle')
  const [error, setError] = useState<string>()
  const [localStream, setLocalStream] = useState<MediaStream>()
  const [isSecureContextValue] = useState(window.isSecureContext)
  const [socketConnected, setSocketConnected] = useState(false)
  const [viewers, setViewers] = useState<ViewerInfo[]>([])
  const [cameraDevices, setCameraDevices] = useState<CameraDeviceOption[]>([])
  const [activeCameraId, setActiveCameraId] = useState('')
  const [switchingCamera, setSwitchingCamera] = useState(false)

  const socketRef = useRef<Socket | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const iceServersRef = useRef<IceServer[]>([])
  const peersRef = useRef<Map<string, PeerInstance>>(new Map())
  const socketHandshakeWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [viewerInboundAudio, setViewerInboundAudio] = useState<Record<string, MediaStream>>({})

  const refreshCameraCatalog = useCallback(async (stream: MediaStream) => {
    try {
      const devices = await listVideoInputDevices()
      const mapped = devices.map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label.trim() || `摄像头 ${i + 1}`
      }))
      setCameraDevices(mapped)
      const sid = stream.getVideoTracks()[0]?.getSettings().deviceId
      if (sid) {
        setActiveCameraId(sid)
      } else if (mapped[0]) {
        setActiveCameraId(mapped[0].deviceId)
      }
    } catch {
      setCameraDevices([])
    }
  }, [])

  const updateViewer = useCallback((socketId: string, patch: Partial<ViewerInfo>) => {
    setViewers((current) => {
      const existing = current.find((viewer) => viewer.socketId === socketId)
      if (!existing) {
        return [...current, { socketId, status: 'idle', ...patch }]
      }

      return current.map((viewer) =>
        viewer.socketId === socketId ? { ...viewer, ...patch } : viewer
      )
    })
  }, [])

  const destroyPeer = useCallback((viewerSocketId: string) => {
    const peer = peersRef.current.get(viewerSocketId)
    if (peer) {
      peer.destroy()
      peersRef.current.delete(viewerSocketId)
    }

    setViewerInboundAudio((prev) => {
      if (!(viewerSocketId in prev)) {
        return prev
      }
      const next = { ...prev }
      delete next[viewerSocketId]
      return next
    })

    setViewers((current) => current.filter((viewer) => viewer.socketId !== viewerSocketId))
  }, [])

  const createPeerForViewer = useCallback((viewerSocketId: string) => {
    const socket = socketRef.current
    const stream = streamRef.current
    if (!socket || !stream) {
      return
    }

    destroyPeer(viewerSocketId)
    updateViewer(viewerSocketId, { status: 'connecting-webrtc' })

    const peer = createCameraPeer(stream, iceServersRef.current)
    peersRef.current.set(viewerSocketId, peer)

    peer.on('signal', (signal) => {
      socket.emit('signal', {
        roomId,
        to: viewerSocketId,
        signal
      })
    })

    peer.on('stream', (remoteStream: MediaStream) => {
      if (remoteStream.getAudioTracks().length === 0) {
        return
      }
      setViewerInboundAudio((prev) => ({ ...prev, [viewerSocketId]: remoteStream }))
    })

    peer.on('connect', () => {
      updateViewer(viewerSocketId, { status: 'connected' })
      void detectSelectedCandidateType(peer).then((candidateType) => {
        if (candidateType) {
          updateViewer(viewerSocketId, { candidateType })
        }
      })
    })

    peer.on('close', () => {
      updateViewer(viewerSocketId, { status: 'disconnected' })
      peersRef.current.delete(viewerSocketId)
    })

    peer.on('error', (peerError) => {
      if (isBenignPeerTeardownError(peerError)) {
        updateViewer(viewerSocketId, { status: 'disconnected' })
        return
      }
      updateViewer(viewerSocketId, { status: 'error' })
      setError(peerError.message)
    })
  }, [destroyPeer, roomId, updateViewer])

  const start = useCallback(async () => {
    setError(undefined)
    setStatus('connecting-socket')

    try {
      if (!window.isSecureContext) {
        throw new Error('当前页面不是 HTTPS 安全上下文，浏览器可能拒绝摄像头或麦克风权限')
      }
      assertWebRtcSupport()

      const [iceServers, stream] = await Promise.all([
        getIceServers(),
        getCameraCaptureStream()
      ])

      iceServersRef.current = iceServers
      streamRef.current = stream
      setLocalStream(stream)
      void refreshCameraCatalog(stream)

      const socket = createSocket()
      socketRef.current = socket

      const clearHandshakeWatchdog = () => {
        if (socketHandshakeWatchdogRef.current) {
          clearTimeout(socketHandshakeWatchdogRef.current)
          socketHandshakeWatchdogRef.current = null
        }
      }

      socketHandshakeWatchdogRef.current = setTimeout(() => {
        socketHandshakeWatchdogRef.current = null
        if (socket.connected) {
          return
        }
        setError(SOCKET_HANDSHAKE_STALL_HINT)
        setStatus('error')
        socket.disconnect()
      }, 14_000)

      socket.on('connect', () => {
        clearHandshakeWatchdog()
        setSocketConnected(true)
        setStatus('waiting-viewer')
        socket.emit('join-room', {
          roomId,
          role: 'camera',
          token: appConfig.roomToken
        })
      })

      socket.on('connect_error', (err) => {
        clearHandshakeWatchdog()
        setError(formatSocketConnectError(err instanceof Error ? err : new Error(String(err))))
        setStatus('error')
      })

      socket.on('disconnect', () => {
        setSocketConnected(false)
        setStatus('disconnected')
      })

      socket.on('viewer-joined', ({ viewerSocketId }: ViewerJoinedMessage) => {
        createPeerForViewer(viewerSocketId)
      })

      socket.on('viewer-left', ({ viewerSocketId }: ViewerLeftMessage) => {
        destroyPeer(viewerSocketId)
      })

      socket.on('signal', ({ from, signal }: SignalMessage) => {
        peersRef.current.get(from)?.signal(signal)
      })

      socket.on('room-error', ({ message }: RoomErrorMessage) => {
        setError(message)
        setStatus('error')
      })
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : '采集端启动失败')
      setStatus('error')
    }
  }, [createPeerForViewer, destroyPeer, refreshCameraCatalog, roomId])

  const switchCamera = useCallback(
    async (deviceId: string) => {
      if (!deviceId || deviceId === activeCameraId || switchingCamera || !streamRef.current) {
        return
      }

      setSwitchingCamera(true)
      setError(undefined)
      let newStream: MediaStream | undefined
      try {
        newStream = await getCameraVideoMediaStreamByDeviceId(deviceId)
        const newVideoTrack = newStream.getVideoTracks()[0]
        if (!newVideoTrack) {
          throw new Error('未拿到新的视频轨')
        }

        await replaceOutgoingVideoTrackForPeers(peersRef.current.values(), newVideoTrack)

        const prev = streamRef.current
        const audioTracks = prev.getAudioTracks().filter((track) => track.readyState === 'live')

        prev.getVideoTracks().forEach((track) => track.stop())

        const combined = new MediaStream([newVideoTrack, ...audioTracks])
        streamRef.current = combined
        setLocalStream(combined)
        setActiveCameraId(deviceId)
        void refreshCameraCatalog(combined)
      } catch (switchErr) {
        newStream?.getTracks().forEach((track) => track.stop())
        setError(switchErr instanceof Error ? switchErr.message : '切换摄像头失败')
      } finally {
        setSwitchingCamera(false)
      }
    },
    [activeCameraId, refreshCameraCatalog, switchingCamera]
  )

  useEffect(() => {
    if (!localStream) {
      return
    }

    const onDevicesChange = () => {
      const s = streamRef.current
      if (s) {
        void refreshCameraCatalog(s)
      }
    }

    navigator.mediaDevices.addEventListener('devicechange', onDevicesChange)
    return () => navigator.mediaDevices.removeEventListener('devicechange', onDevicesChange)
  }, [localStream, refreshCameraCatalog])

  const stop = useCallback(() => {
    if (socketHandshakeWatchdogRef.current) {
      clearTimeout(socketHandshakeWatchdogRef.current)
      socketHandshakeWatchdogRef.current = null
    }

    for (const peer of peersRef.current.values()) {
      peer.destroy()
    }
    peersRef.current.clear()

    socketRef.current?.disconnect()
    socketRef.current = null

    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setLocalStream(undefined)
    setViewers([])
    setViewerInboundAudio({})
    setCameraDevices([])
    setActiveCameraId('')
    setSwitchingCamera(false)
    setSocketConnected(false)
    setStatus('idle')
  }, [])

  const restart = useCallback(() => {
    stop()
    window.setTimeout(() => {
      void start()
    }, 0)
  }, [start, stop])

  useEffect(() => {
    void start()
    return () => stop()
  }, [start, stop])

  return {
    status,
    error,
    localStream,
    isSecureContext: isSecureContextValue,
    socketConnected,
    viewers,
    viewerInboundAudio,
    cameraDevices,
    activeCameraId,
    switchingCamera,
    switchCamera,
    restart,
    stop
  }
}
