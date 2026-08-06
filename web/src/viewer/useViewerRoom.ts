import { useCallback, useEffect, useRef, useState } from 'react'
import type SimplePeer from 'simple-peer'
import type { Socket } from 'socket.io-client'
import { appConfig, type IceServer } from '../config'
import type { CameraDeviceOption } from '../shared/cameraDeviceToolbar'
import {
  assertWebRtcSupport,
  createViewerPeer,
  getIceServers,
  getViewerMicMediaStream,
  isBenignPeerTeardownError,
  type PeerInstance
} from '../shared/rtc'
import {
  createSocket,
  formatSocketConnectError,
  SOCKET_HANDSHAKE_STALL_HINT
} from '../shared/socket'
import type { ConnectionStatus } from '../shared/status'
import { getViewerDeviceName } from '../shared/deviceName'
import {
  DEFAULT_VIDEO_QUALITY_PREFERENCE,
  type VideoQualityPreference
} from '../shared/videoQualityPreference'
import {
  sampleWebRtcLinkStats,
  type WebRtcLinkStats,
  type WebRtcStatsSnapshot
} from '../shared/webrtcStats'

interface SignalMessage {
  from: string
  signal: SimplePeer.SignalData
}

interface RoomErrorMessage {
  message: string
}

interface RoomStateMessage {
  hasCamera: boolean
  viewerCount: number
  viewerSocketIds?: string[]
}

interface CameraCatalogMessage {
  devices: CameraDeviceOption[]
  activeCameraId: string
}

interface CameraSwitchFailedMessage {
  message: string
}

interface CameraConnectionInfoMessage {
  connectionType: string
}

interface RoomClockMessage {
  ts: number
}

interface CameraTelemetryMessage {
  temperatureC: number | null
}

export function useViewerRoom(roomId: string) {
  const [status, setStatus] = useState<ConnectionStatus>('idle')
  const [error, setError] = useState<string>()
  const [remoteStream, setRemoteStream] = useState<MediaStream>()
  const [socketConnected, setSocketConnected] = useState(false)
  const [cameraOnline, setCameraOnline] = useState(false)
  const [viewerCount, setViewerCount] = useState(0)
  const [linkStats, setLinkStats] = useState<WebRtcLinkStats>()
  const [cameraConnectionType, setCameraConnectionType] = useState<string>()
  const [cameraTemperatureC, setCameraTemperatureC] = useState<number | null>()

  const [cameraDevices, setCameraDevices] = useState<CameraDeviceOption[]>([])
  const [activeCameraId, setActiveCameraId] = useState('')
  const [switchingCamera, setSwitchingCamera] = useState(false)
  const [videoQualityPreference, setVideoQualityPreferenceState] = useState<VideoQualityPreference>(
    DEFAULT_VIDEO_QUALITY_PREFERENCE
  )

  const socketRef = useRef<Socket | null>(null)
  const peerRef = useRef<PeerInstance | null>(null)
  const cameraSocketIdRef = useRef<string | null>(null)
  const iceServersRef = useRef<IceServer[]>([])
  const remoteStreamRef = useRef<MediaStream | null>(null)
  const socketHandshakeWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const micAttachedToPeerRef = useRef(false)
  const micDesiredRef = useRef(false)
  const statsSnapshotRef = useRef<WebRtcStatsSnapshot | undefined>(undefined)
  const statsTimerRef = useRef<number | null>(null)
  const videoQualityPreferenceRef = useRef<VideoQualityPreference>(DEFAULT_VIDEO_QUALITY_PREFERENCE)

  const [dialogMicOn, setDialogMicOn] = useState(false)
  const [pushMicHeld, setPushMicHeld] = useState(false)

  /** 采集端时间 − 本机 Date.now()，用于推导与采集端一致的显示时间 */
  const [cameraClockSkewMs, setCameraClockSkewMs] = useState<number | null>(null)

  useEffect(() => {
    micDesiredRef.current = dialogMicOn || pushMicHeld
  }, [dialogMicOn, pushMicHeld])

  useEffect(() => {
    if (dialogMicOn) {
      setPushMicHeld(false)
    }
  }, [dialogMicOn])

  const syncViewerUpstreamMic = useCallback(async () => {
    const peer = peerRef.current
    const desired = micDesiredRef.current

    if (!peer || peer.destroyed) {
      micStreamRef.current?.getAudioTracks().forEach((track) => {
        track.enabled = false
      })
      return
    }

    try {
      if (!desired) {
        micStreamRef.current?.getAudioTracks().forEach((track) => {
          track.enabled = false
        })
        return
      }

      let stream = micStreamRef.current
      if (!stream) {
        stream = await getViewerMicMediaStream()
        micStreamRef.current = stream
      }

      if (!micDesiredRef.current) {
        stream.getAudioTracks().forEach((track) => {
          track.enabled = false
        })
        return
      }

      stream.getAudioTracks().forEach((track) => {
        track.enabled = true
      })

      if (!micAttachedToPeerRef.current) {
        peer.addStream(stream)
        micAttachedToPeerRef.current = true
      }
    } catch (micErr) {
      setError(micErr instanceof Error ? micErr.message : '无法使用麦克风')
    }
  }, [])

  const stopLinkStats = useCallback(() => {
    if (statsTimerRef.current !== null) {
      window.clearInterval(statsTimerRef.current)
      statsTimerRef.current = null
    }
    statsSnapshotRef.current = undefined
    setLinkStats(undefined)
  }, [])

  const startLinkStats = useCallback(
    (peer: PeerInstance) => {
      stopLinkStats()

      const sample = async () => {
        if (peerRef.current !== peer || peer.destroyed) {
          return
        }
        try {
          const result = await sampleWebRtcLinkStats(peer, 'inbound', statsSnapshotRef.current)
          if (!result || peerRef.current !== peer) {
            return
          }
          statsSnapshotRef.current = result.snapshot
          setLinkStats(result.stats)
        } catch {
          // A transient getStats failure should not tear down an otherwise healthy call.
        }
      }

      void sample()
      statsTimerRef.current = window.setInterval(() => void sample(), 2000)
    },
    [stopLinkStats]
  )

  const destroyPeer = useCallback(() => {
    stopLinkStats()
    peerRef.current?.destroy()
    peerRef.current = null
    cameraSocketIdRef.current = null
    remoteStreamRef.current = null
    micAttachedToPeerRef.current = false
    setRemoteStream(undefined)
    void syncViewerUpstreamMic()
  }, [stopLinkStats, syncViewerUpstreamMic])

  const ensurePeer = useCallback((cameraSocketId: string): PeerInstance => {
    if (peerRef.current && cameraSocketIdRef.current === cameraSocketId) {
      return peerRef.current
    }

    destroyPeer()
    setStatus('connecting-webrtc')
    cameraSocketIdRef.current = cameraSocketId

    const peer = createViewerPeer(iceServersRef.current)
    peerRef.current = peer

    peer.on('signal', (signal) => {
      if (peerRef.current !== peer) {
        return
      }
      socketRef.current?.emit('signal', {
        roomId,
        to: cameraSocketId,
        signal
      })
    })

    peer.on('stream', (stream) => {
      if (peerRef.current !== peer) {
        return
      }
      remoteStreamRef.current = stream
      setRemoteStream(stream)
      setStatus('connected')
    })

    peer.on('connect', () => {
      if (peerRef.current !== peer) {
        return
      }
      setStatus('connected')
      startLinkStats(peer)
      void syncViewerUpstreamMic()
    })

    peer.on('close', () => {
      if (peerRef.current !== peer) {
        return
      }
      setStatus('disconnected')
    })

    peer.on('error', (peerError) => {
      if (peerRef.current !== peer) {
        return
      }
      if (isBenignPeerTeardownError(peerError)) {
        setStatus('disconnected')
        return
      }
      setStatus('error')
      setError(peerError.message)
    })

    return peer
  }, [destroyPeer, roomId, startLinkStats, syncViewerUpstreamMic])

  const start = useCallback(async () => {
    setError(undefined)
    setStatus('connecting-socket')

    try {
      if (!window.isSecureContext) {
        throw new Error('当前页面不是 HTTPS 安全上下文，对讲等功能可能不可用')
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
        setStatus('waiting-camera')
        void getViewerDeviceName().then((deviceName) => {
          if (!socket.connected) return
          socket.emit('join-room', {
            roomId,
            role: 'viewer',
            token: appConfig.roomToken,
            deviceName
          })
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

      socket.on('room-state', ({ hasCamera, viewerCount: nextViewerCount }: RoomStateMessage) => {
        socket.emit('set-video-quality', {
          roomId,
          preference: videoQualityPreferenceRef.current
        })
        setCameraOnline(hasCamera)
        setViewerCount(nextViewerCount)
        if (!hasCamera && !remoteStreamRef.current) {
          setStatus('waiting-camera')
        }
      })

      socket.on('camera-catalog', ({ devices, activeCameraId: nextActive }: CameraCatalogMessage) => {
        setCameraDevices(devices)
        setActiveCameraId(nextActive)
        setSwitchingCamera(false)
      })

      socket.on('camera-switch-failed', ({ message }: CameraSwitchFailedMessage) => {
        setSwitchingCamera(false)
        setError(message)
      })

      socket.on('camera-connection-info', ({ connectionType }: CameraConnectionInfoMessage) => {
        setCameraConnectionType(connectionType)
      })

      socket.on('signal', ({ from, signal }: SignalMessage) => {
        const peer = ensurePeer(from)
        peer.signal(signal)
      })

      socket.on('camera-left', () => {
        setCameraOnline(false)
        setCameraTemperatureC(undefined)
        setCameraClockSkewMs(null)
        setCameraConnectionType(undefined)
        destroyPeer()
        setCameraDevices([])
        setActiveCameraId('')
        setSwitchingCamera(false)
        setStatus('waiting-camera')
      })

      socket.on('room-error', ({ message }: RoomErrorMessage) => {
        setError(message)
        setStatus('error')
      })

      socket.on('room-clock', ({ ts }: RoomClockMessage) => {
        if (typeof ts === 'number' && Number.isFinite(ts)) {
          setCameraClockSkewMs(ts - Date.now())
        }
      })

      socket.on('camera-telemetry', ({ temperatureC }: CameraTelemetryMessage) => {
        if (
          temperatureC === null ||
          (typeof temperatureC === 'number' &&
            Number.isFinite(temperatureC) &&
            temperatureC >= -50 &&
            temperatureC <= 150)
        ) {
          setCameraTemperatureC(temperatureC)
        }
      })
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : '观看端启动失败')
      setStatus('error')
    }
  }, [destroyPeer, ensurePeer, roomId])

  useEffect(() => {
    void syncViewerUpstreamMic()
  }, [dialogMicOn, pushMicHeld, syncViewerUpstreamMic])

  const switchRemoteCamera = useCallback(
    (deviceId: string) => {
      const socket = socketRef.current
      if (!deviceId || deviceId === activeCameraId || switchingCamera || !socket?.connected) {
        return
      }

      setError(undefined)
      setSwitchingCamera(true)
      socket.emit('switch-camera', { roomId, deviceId })
    },
    [activeCameraId, roomId, switchingCamera]
  )


  const setVideoQualityPreference = useCallback(
    (preference: VideoQualityPreference) => {
      videoQualityPreferenceRef.current = preference
      setVideoQualityPreferenceState(preference)
      const socket = socketRef.current
      if (socket?.connected) {
        socket.emit('set-video-quality', { roomId, preference })
      }
    },
    [roomId]
  )
  const stop = useCallback(() => {
    if (socketHandshakeWatchdogRef.current) {
      clearTimeout(socketHandshakeWatchdogRef.current)
      socketHandshakeWatchdogRef.current = null
    }

    destroyPeer()
    micStreamRef.current?.getTracks().forEach((track) => track.stop())
    micStreamRef.current = null
    micAttachedToPeerRef.current = false
    setDialogMicOn(false)
    setPushMicHeld(false)
    setCameraDevices([])
    setActiveCameraId('')
    setSwitchingCamera(false)
    socketRef.current?.disconnect()
    socketRef.current = null
    setSocketConnected(false)
    setCameraOnline(false)
    setViewerCount(0)
    setCameraTemperatureC(undefined)
    setCameraClockSkewMs(null)
    setCameraConnectionType(undefined)
    setStatus('idle')
  }, [destroyPeer])

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
    remoteStream,
    socketConnected,
    cameraOnline,
    viewerCount,
    linkStats,
    cameraConnectionType,
    cameraTemperatureC,
    dialogMicOn,
    setDialogMicOn,
    pushMicHeld,
    setPushMicHeld,
    cameraDevices,
    activeCameraId,
    switchingCamera,
    switchRemoteCamera,
    cameraClockSkewMs,
    restart,
    videoQualityPreference,
    setVideoQualityPreference,
    stop
  }
}
