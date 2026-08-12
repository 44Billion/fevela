import { createMuteListDraftEvent } from '@/lib/draft-event'
import client from '@/services/client.service'
import dayjs from 'dayjs'
import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useNostr } from './NostrProvider'
import { TMutedList } from '@/types'
import { NostrEvent } from '@nostr/tools/wasm'

type TMuteListContext = {
  changing: boolean
  supportsEncryption: boolean
  mutePubkeySet: Set<string>
  muteListEvent: NostrEvent | null
  getMutePubkeys: () => string[]
  getMuteType: (pubkey: string) => 'public' | 'private' | null
  mutePublicly: (pubkey: string) => Promise<void>
  mutePrivately: (pubkey: string) => Promise<void>
  unmute: (pubkey: string) => Promise<void>
}

const MuteListContext = createContext<TMuteListContext | undefined>(undefined)

export const useMuteList = () => {
  const context = useContext(MuteListContext)
  if (!context) {
    throw new Error('useMuteList must be used within a MuteListProvider')
  }
  return context
}

type TMuteListFetchResult = Awaited<ReturnType<typeof client.fetchMuteList>>

export function MuteListProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const {
    pubkey: accountPubkey,
    muteList,
    muteListEvent,
    publish,
    updateMuteListEvent,
    supportsEncryption,
    nip04Encrypt,
    nip04Decrypt
  } = useNostr()
  const [changing, setChanging] = useState(false)
  const [lastPublished, setLastPublished] = useState(0)

  const getMutePubkeys = () => {
    return [...muteList.public, ...muteList.private]
  }

  const mutePubkeySet = useMemo(() => {
    return new Set([...muteList.private, ...muteList.public])
  }, [muteList])

  const getMuteType = useCallback(
    (pubkey: string): 'public' | 'private' | null => {
      if (muteList.public.includes(pubkey)) return 'public'
      if (muteList.private.includes(pubkey)) return 'private'
      return null
    },
    [muteList]
  )

  const fetchLatestMuteList = async (): Promise<TMuteListFetchResult> => {
    const result = await client.fetchMuteList(
      accountPubkey!,
      supportsEncryption ? nip04Decrypt : undefined
    )

    // Never modify the list if the private part could not be read, we would wipe it
    if (result.decryptError) {
      throw new Error(t('Unable to decrypt your private mute list, no changes were made'))
    }

    if (!result.event) {
      const confirmed = confirm(t('MuteListNotFoundConfirmation'))
      if (!confirmed) {
        throw new Error('Mute list not found')
      }
    }

    return result
  }

  const publishNewMuteListEvent = async (current: TMuteListFetchResult, list: TMutedList) => {
    if (!accountPubkey) return

    console.debug('[mute] publishing:', { public: list.public.length, private: list.private.length })

    // Keep non-pubkey mutes (threads, hashtags, words) possibly set by other clients
    const otherPublicTags = (current.event?.tags ?? []).filter((tag) => tag[0] !== 'p')
    const tags = [...otherPublicTags, ...list.public.map((pubkey) => ['p', pubkey])]
    const otherPrivateTags = current.privateTags.filter((tag) => tag[0] !== 'p')
    const privateTags = [...otherPrivateTags, ...list.private.map((pubkey) => ['p', pubkey])]

    let content = ''
    if (privateTags.length > 0) {
      if (!supportsEncryption) {
        throw new Error(t('Your signer does not support encryption, private mutes are unavailable'))
      }
      content = await nip04Encrypt(accountPubkey, JSON.stringify(privateTags))
    }

    if (dayjs().unix() === lastPublished) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    const newMuteListDraftEvent = createMuteListDraftEvent(tags, content)
    const event = await publish(newMuteListDraftEvent)
    console.debug('[mute] published event:', event.id, 'created_at:', event.created_at)
    toast.success(t('Successfully updated mute list'))
    setLastPublished(dayjs().unix())
    updateMuteListEvent(event)

    return event
  }

  const mutePublicly = async (pubkey: string) => {
    if (!accountPubkey || changing) return

    setChanging(true)
    try {
      const result = await fetchLatestMuteList()
      const { list } = result

      if (!list.public.includes(pubkey)) {
        list.public.push(pubkey)
        const idx = list.private.indexOf(pubkey)
        if (idx !== -1) list.private.splice(idx, 1)
        await publishNewMuteListEvent(result, list)
      }
    } catch (error) {
      console.error('[mute] mutePublicly failed:', error)
      toast.error(t('Failed to mute user publicly') + ': ' + (error as Error).message)
    } finally {
      setChanging(false)
    }
  }

  const mutePrivately = async (pubkey: string) => {
    if (!accountPubkey || changing) return

    setChanging(true)
    try {
      if (!supportsEncryption) {
        throw new Error(t('Your signer does not support encryption, private mutes are unavailable'))
      }

      const result = await fetchLatestMuteList()
      const { list } = result

      if (!list.private.includes(pubkey)) {
        list.private.push(pubkey)
        const idx = list.public.indexOf(pubkey)
        if (idx !== -1) list.public.splice(idx, 1)
        await publishNewMuteListEvent(result, list)
      }
    } catch (error) {
      console.error('[mute] mutePrivately failed:', error)
      toast.error(t('Failed to mute user privately') + ': ' + (error as Error).message)
    } finally {
      setChanging(false)
    }
  }

  const unmute = async (pubkey: string) => {
    if (!accountPubkey || changing) return

    setChanging(true)
    try {
      const result = await fetchLatestMuteList()
      const { list } = result

      let modified = false
      const privateIdx = list.private.indexOf(pubkey)
      if (privateIdx !== -1) {
        list.private.splice(privateIdx, 1)
        modified = true
      }
      const publicIdx = list.public.indexOf(pubkey)
      if (publicIdx !== -1) {
        list.public.splice(publicIdx, 1)
        modified = true
      }

      if (modified) {
        await publishNewMuteListEvent(result, list)
      }
    } catch (error) {
      console.error('[mute] unmute failed:', error)
      toast.error(t('Failed to unmute user') + ': ' + (error as Error).message)
    } finally {
      setChanging(false)
    }
  }

  return (
    <MuteListContext.Provider
      value={{
        mutePubkeySet,
        muteListEvent,
        changing,
        supportsEncryption,
        getMutePubkeys,
        getMuteType,
        mutePublicly,
        mutePrivately,
        unmute
      }}
    >
      {children}
    </MuteListContext.Provider>
  )
}
