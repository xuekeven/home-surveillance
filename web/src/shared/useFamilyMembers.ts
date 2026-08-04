import { useEffect, useState } from 'react'
import { fetchFamilyMembersForRoom } from './familyMembersApi'
import type { StoredFamilyMember } from './familyMemberTypes'

const POLL_MS = 45_000

export interface FamilyMembersLoadState {
  members: StoredFamilyMember[]
  /** 首次成功响应（包括服务端明确返回空列表）前为 false，识别逻辑不得据此判定陌生人 */
  ready: boolean
}

/** 从服务端拉取家庭成员列表；轮询失败时保留最后一次成功结果，避免把家人误判为陌生人 */
export function useFamilyMembers(roomToken: string, fetchEnabled = true): FamilyMembersLoadState {
  const [state, setState] = useState<FamilyMembersLoadState>({ members: [], ready: false })

  useEffect(() => {
    if (!fetchEnabled) {
      setState({ members: [], ready: false })
      return undefined
    }

    let cancelled = false
    setState({ members: [], ready: false })

    async function load() {
      try {
        const next = await fetchFamilyMembersForRoom(roomToken)
        if (!cancelled) {
          setState({ members: next, ready: true })
        }
      } catch {
        // 保留最后一次成功结果；首次加载失败时 ready 仍为 false，告警链路不会启动。
      }
    }

    void load()
    const timer = window.setInterval(() => void load(), POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [roomToken, fetchEnabled])

  return state
}
