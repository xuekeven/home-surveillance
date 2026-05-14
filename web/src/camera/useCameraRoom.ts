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
import type { CameraDeviceOption } from '../shared/cameraDeviceToolbar'
import {
  assertWebRtcSupport,
  boostOutgoingVideoEncodingForPeers,
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

interface ViewerSwitchCameraMessage {
  deviceId: string
  viewerSocketId: string
}

interface RoomStateFromServer {
  hasCamera: boolean
  viewerCount: number
  viewerSocketIds?: string[]
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
  const pendingViewersRef = useRef<string[]>([])
  const roomCaptureStartedRef = useRef(false)

  const refreshCameraCatalog = useCallback(
    async (stream: MediaStream) => {
      try {
        const devices = await listVideoInputDevices()
        const mapped = devices.map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label.trim() || `摄像头 ${i + 1}`
        }))
        setCameraDevices(mapped)
        const sid = stream.getVideoTracks()[0]?.getSettings().deviceId
        const nextActive = sid || mapped[0]?.deviceId || ''
        setActiveCameraId(nextActive)

        const socket = socketRef.current
        if (socket?.connected) {
          socket.emit('camera-catalog', {
            roomId,
            devices: mapped,
            activeCameraId: nextActive
          })
        }
      } catch {
        setCameraDevices([])
      }
    },
    [roomId]
  )

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

  const createPeerForViewer = useCallback(
    (viewerSocketId: string) => {
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
        if (remoteStream.getAudioTracks().length > 0) {
          setViewerInboundAudio((prev) => ({ ...prev, [viewerSocketId]: remoteStream }))
        }
      })

      peer.on('connect', () => {
        updateViewer(viewerSocketId, { status: 'connected' })
        void detectSelectedCandidateType(peer).then((candidateType) => {
          if (candidateType) {
            updateViewer(viewerSocketId, { candidateType })
          }
        })
        void boostOutgoingVideoEncodingForPeers([peer])
      })

      peer.on('close', () => {
        destroyPeer(viewerSocketId)
      })

      peer.on('error', (peerError) => {
        if (isBenignPeerTeardownError(peerError)) {
          destroyPeer(viewerSocketId)
          return
        }
        updateViewer(viewerSocketId, { status: 'error' })
        setError(peerError.message)
      })
    },
    [destroyPeer, roomId, updateViewer]
  )

  /** 丢弃服务端已不认作在线的 viewer，并拆掉对应 Peer（不包含新增，仍靠 viewer-joined） */
  const reconcileViewersFromServer = useCallback((viewerSocketIds: string[]) => {
    const allow = new Set(viewerSocketIds)
    setViewers((current) => current.filter((v) => allow.has(v.socketId)))
    for (const id of [...peersRef.current.keys()]) {
      if (!allow.has(id)) {
        destroyPeer(id)
      }
    }
  }, [destroyPeer])


  const switchCamera = useCallback(
    async (deviceId: string, options?: { viewerSocketId?: string }) => {
      const viewerSocketId = options?.viewerSocketId

      if (!deviceId || !streamRef.current) {
        return
      }

      if (deviceId === activeCameraId) {
        if (viewerSocketId && socketRef.current?.connected && streamRef.current) {
          void refreshCameraCatalog(streamRef.current)
        }
        return
      }

      if (switchingCamera) {
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
        void boostOutgoingVideoEncodingForPeers(peersRef.current.values())
      } catch (switchErr) {
        newStream?.getTracks().forEach((track) => track.stop())
        const msg = switchErr instanceof Error ? switchErr.message : '切换摄像头失败'
        setError(msg)
        if (viewerSocketId && socketRef.current?.connected) {
          socketRef.current.emit('camera-switch-failed', { viewerSocketId, message: msg })
        }
      } finally {
        setSwitchingCamera(false)
      }
    },
    [activeCameraId, refreshCameraCatalog, switchingCamera]
  )

  useEffect(() => {
    const socket = socketRef.current
    if (!socketConnected || !socket) {
      return undefined
    }

    const onViewerSwitchCamera = (payload: ViewerSwitchCameraMessage) => {
      void switchCamera(payload.deviceId, { viewerSocketId: payload.viewerSocketId })
    }

    socket.on('viewer-switch-camera', onViewerSwitchCamera)
    return () => {
      socket.off('viewer-switch-camera', onViewerSwitchCamera)
    }
  }, [socketConnected, switchCamera])

  const start = useCallback(async () => {
    setError(undefined)
    setStatus('connecting-socket')
    pendingViewersRef.current = []
    roomCaptureStartedRef.current = false

    try {
      if (!window.isSecureContext) {
        throw new Error('当前页面不是 HTTPS 安全上下文，浏览器可能拒绝摄像头或麦克风权限')
      }
      assertWebRtcSupport()

      iceServersRef.current = await getIceServers()

      const socket = createSocket()
      socketRef.current = socket

      const clearHandshakeWatchdog = () => {
        if (socketHandshakeWatchdogRef.current) {
          clearTimeout(socketHandshakeWatchdogRef.current)
          socketHandshakeWatchdogRef.current = null
        }
      }

      const denyMediaAndPeers = () => {
        for (const peer of peersRef.current.values()) {
          peer.destroy()
        }
        peersRef.current.clear()
        streamRef.current?.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        setLocalStream(undefined)
        setCameraDevices([])
        setActiveCameraId('')
        setViewers([])
        setViewerInboundAudio({})
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
        setStatus('joining-room')
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
        setStatus((prev) => {
          if (prev === 'idle') {
            return 'idle'
          }
          if (prev === 'error') {
            return 'error'
          }
          return 'disconnected'
        })
      })

      socket.on('room-state', (state: RoomStateFromServer) => {
        if (Array.isArray(state.viewerSocketIds)) {
          reconcileViewersFromServer(state.viewerSocketIds)
        }

        if (roomCaptureStartedRef.current) {
          return
        }
        roomCaptureStartedRef.current = true
        void (async () => {
          try {
            setStatus('connecting-media')
            const stream = await getCameraCaptureStream()
            streamRef.current = stream
            setLocalStream(stream)
            await refreshCameraCatalog(stream)
            setStatus('waiting-viewer')

            const pending = [...pendingViewersRef.current]
            pendingViewersRef.current = []
            for (const viewerSocketId of pending) {
              createPeerForViewer(viewerSocketId)
            }
          } catch (captureErr) {
            roomCaptureStartedRef.current = false
            pendingViewersRef.current = []
            denyMediaAndPeers()
            setError(captureErr instanceof Error ? captureErr.message : '采集端启动失败')
            setStatus('error')
          }
        })()
      })

      socket.on('viewer-joined', ({ viewerSocketId }: ViewerJoinedMessage) => {
        const s = streamRef.current
        if (s) {
          createPeerForViewer(viewerSocketId)
          void refreshCameraCatalog(s)
        } else {
          pendingViewersRef.current.push(viewerSocketId)
        }
      })

      socket.on('viewer-left', ({ viewerSocketId }: ViewerLeftMessage) => {
        destroyPeer(viewerSocketId)
      })

      socket.on('signal', ({ from, signal }: SignalMessage) => {
        peersRef.current.get(from)?.signal(signal)
      })

      socket.on('room-error', ({ message }: RoomErrorMessage) => {
        clearHandshakeWatchdog()
        roomCaptureStartedRef.current = false
        pendingViewersRef.current = []
        denyMediaAndPeers()
        setError(message)
        setStatus('error')
      })
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : '采集端启动失败')
      setStatus('error')
    }
  }, [createPeerForViewer, destroyPeer, reconcileViewersFromServer, refreshCameraCatalog, roomId])

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

  useEffect(() => {
    if (!localStream || !socketConnected) {
      return undefined
    }

    const socket = socketRef.current
    if (!socket) {
      return undefined
    }

    const tick = () => {
      if (!socket.connected) {
        return
      }
      socket.emit('camera-room-clock', { roomId, ts: Date.now() })
    }

    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [localStream, roomId, socketConnected])

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
    pendingViewersRef.current = []
    roomCaptureStartedRef.current = false
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
