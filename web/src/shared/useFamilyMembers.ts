import { useEffect, useState } from 'react'
import { fetchFamilyMembersForRoom } from './familyMembersApi'
import type { StoredFamilyMember } from './familyMemberTypes'

const POLL_MS = 45_000

/** 从服务端拉取家庭成员列表（与后台登记同源）；失败时返回上次结果或空数组 */
export function useFamilyMembers(roomToken: string, fetchEnabled = true): StoredFamilyMember[] {
  const [members, setMembers] = useState<StoredFamilyMember[]>([])

  useEffect(() => {
    if (!fetchEnabled) {
      setMembers([])
      return undefined
    }

    let cancelled = false

    async function load() {
      try {
        const next = await fetchFamilyMembersForRoom(roomToken)
        if (!cancelled) {
          setMembers(next)
        }
      } catch {
        if (!cancelled) {
          setMembers([])
        }
      }
    }

    void load()
    const timer = window.setInterval(() => void load(), POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [roomToken, fetchEnabled])

  return members
}
