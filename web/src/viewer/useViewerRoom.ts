import { useCallback, useEffect, useRef, useState } from 'react'
import type SimplePeer from 'simple-peer'
import type { Socket } from 'socket.io-client'
import { appConfig, type IceServer } from '../config'
import { assertWebRtcSupport, createViewerPeer, detectSelectedCandidateType, getIceServers, type PeerInstance } from '../shared/rtc'
import { createSocket } from '../shared/socket'
import type { ConnectionStatus } from '../shared/status'

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
}

export function useViewerRoom(roomId: string) {
  const [status, setStatus] = useState<ConnectionStatus>('idle')
  const [error, setError] = useState<string>()
  const [remoteStream, setRemoteStream] = useState<MediaStream>()
  const [socketConnected, setSocketConnected] = useState(false)
  const [cameraOnline, setCameraOnline] = useState(false)
  const [viewerCount, setViewerCount] = useState(0)
  const [candidateType, setCandidateType] = useState<string>()

  const socketRef = useRef<Socket | null>(null)
  const peerRef = useRef<PeerInstance | null>(null)
  const cameraSocketIdRef = useRef<string | null>(null)
  const iceServersRef = useRef<IceServer[]>([])
  const remoteStreamRef = useRef<MediaStream | null>(null)

  const destroyPeer = useCallback(() => {
    peerRef.current?.destroy()
    peerRef.current = null
    cameraSocketIdRef.current = null
    remoteStreamRef.current = null
    setRemoteStream(undefined)
    setCandidateType(undefined)
  }, [])

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
      socketRef.current?.emit('signal', {
        roomId,
        to: cameraSocketId,
        signal
      })
    })

    peer.on('stream', (stream) => {
      remoteStreamRef.current = stream
      setRemoteStream(stream)
      setStatus('connected')
    })

    peer.on('connect', () => {
      setStatus('connected')
      void detectSelectedCandidateType(peer).then((type) => {
        if (type) {
          setCandidateType(type)
        }
      })
    })

    peer.on('close', () => {
      setStatus('disconnected')
    })

    peer.on('error', (peerError) => {
      setStatus('error')
      setError(peerError.message)
    })

    return peer
  }, [destroyPeer, roomId])

  const start = useCallback(async () => {
    setError(undefined)
    setStatus('connecting-socket')

    try {
      assertWebRtcSupport()
      iceServersRef.current = await getIceServers()
      const socket = createSocket()
      socketRef.current = socket

      socket.on('connect', () => {
        setSocketConnected(true)
        setStatus('waiting-camera')
        socket.emit('join-room', {
          roomId,
          role: 'viewer',
          token: appConfig.roomToken
        })
      })

      socket.on('disconnect', () => {
        setSocketConnected(false)
        setStatus('disconnected')
      })

      socket.on('room-state', ({ hasCamera, viewerCount: nextViewerCount }: RoomStateMessage) => {
        setCameraOnline(hasCamera)
        setViewerCount(nextViewerCount)
        if (!hasCamera && !remoteStreamRef.current) {
          setStatus('waiting-camera')
        }
      })

      socket.on('signal', ({ from, signal }: SignalMessage) => {
        const peer = ensurePeer(from)
        peer.signal(signal)
      })

      socket.on('camera-left', () => {
        setCameraOnline(false)
        destroyPeer()
        setStatus('waiting-camera')
      })

      socket.on('room-error', ({ message }: RoomErrorMessage) => {
        setError(message)
        setStatus('error')
      })
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : '观看端启动失败')
      setStatus('error')
    }
  }, [destroyPeer, ensurePeer, roomId])

  const stop = useCallback(() => {
    destroyPeer()
    socketRef.current?.disconnect()
    socketRef.current = null
    setSocketConnected(false)
    setCameraOnline(false)
    setViewerCount(0)
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
    candidateType,
    restart,
    stop
  }
}
