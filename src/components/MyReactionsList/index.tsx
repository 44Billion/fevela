import { Input } from '@/components/ui/input'
import { NOTIFICATION_LIST_STYLE } from '@/constants'
import { compareEvents } from '@/lib/event'
import { getZapInfoFromEvent } from '@/lib/event-metadata'
import { tagNameEquals } from '@/lib/tag'
import { isTouchDevice } from '@/lib/utils'
import { useNostr } from '@/providers/NostrProvider'
import { useUserPreferences } from '@/providers/UserPreferencesProvider'
import client from '@/services/client.service'
import { TFeedSubRequest } from '@/types'
import { SubCloser } from '@nostr/tools/abstract-pool'
import { matchFilter } from '@nostr/tools/filter'
import * as kinds from '@nostr/tools/kinds'
import { NostrEvent } from '@nostr/tools/wasm'
import dayjs from 'dayjs'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import PullToRefresh from 'react-simple-pull-to-refresh'
import { NotificationSkeleton } from '../NotificationList/NotificationItem/Notification'
import { RefreshButton } from '../RefreshButton'
import { getMyReactionTargetId, MyReactionItem } from './MyReactionItem'

const LIMIT = 100
const SHOW_COUNT = 30

const MyReactionsList = forwardRef((_, ref) => {
  const { t } = useTranslation()
  const { pubkey } = useNostr()
  const { notificationListStyle } = useUserPreferences()
  const [refreshCount, setRefreshCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [events, setEvents] = useState<NostrEvent[]>([])
  const [subRequests, setSubRequests] = useState<TFeedSubRequest[]>([])
  const [showCount, setShowCount] = useState(SHOW_COUNT)
  const [until, setUntil] = useState<number | undefined>(dayjs().unix())
  const [searchInput, setSearchInput] = useState('')
  const [targetEvents, setTargetEvents] = useState<Map<string, NostrEvent | null>>(new Map())
  const supportTouch = useMemo(() => isTouchDevice(), [])
  const topRef = useRef<HTMLDivElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const fetchingTargetsRef = useRef(new Set<string>())

  // Collapse repeated reactions to the same note, keeping the most recent one
  const items = useMemo(() => {
    const seenReactionTargets = new Set<string>()
    const result: NostrEvent[] = []
    for (const event of events) {
      if (event.kind === kinds.Reaction) {
        const targetTag =
          event.tags.findLast(tagNameEquals('a')) ?? event.tags.findLast(tagNameEquals('e'))
        const targetId = targetTag?.[1]
        if (!targetId || seenReactionTargets.has(targetId)) continue
        seenReactionTargets.add(targetId)
      }
      result.push(event)
    }
    return result
  }, [events])

  // Resolve target notes so the search can match their text
  useEffect(() => {
    if (!searchInput.trim()) return

    items.forEach((event) => {
      const targetId = getMyReactionTargetId(event)
      if (!targetId || targetEvents.has(targetId) || fetchingTargetsRef.current.has(targetId)) {
        return
      }
      fetchingTargetsRef.current.add(targetId)
      client
        .fetchEvent(targetId)
        .then((target) => {
          setTargetEvents((old) => new Map(old).set(targetId, target ?? null))
        })
        .catch(() => {
          setTargetEvents((old) => new Map(old).set(targetId, null))
        })
    })
  }, [searchInput, items])

  // Match the reaction emoji, the zap comment or the target note's text
  const filteredItems = useMemo(() => {
    const term = searchInput.trim().toLowerCase()
    if (!term) return items

    return items.filter((event) => {
      if (event.kind === kinds.Reaction && event.content.toLowerCase().includes(term)) {
        return true
      }
      if (event.kind === kinds.Zap) {
        const comment = getZapInfoFromEvent(event)?.comment
        if (comment && comment.toLowerCase().includes(term)) {
          return true
        }
      }
      const targetId = getMyReactionTargetId(event)
      const target = targetId ? targetEvents.get(targetId) : undefined
      return !!target && target.content.toLowerCase().includes(term)
    })
  }, [items, searchInput, targetEvents])

  useImperativeHandle(
    ref,
    () => ({
      refresh: () => {
        if (loading) return
        setRefreshCount((count) => count + 1)
      }
    }),
    [loading]
  )

  useEffect(() => {
    if (!pubkey) {
      setUntil(undefined)
      return
    }

    setLoading(true)
    setEvents([])
    setShowCount(SHOW_COUNT)

    let subc: SubCloser | undefined

    // Start with local DB immediately, no waiting for relay list fetch
    const localSubRequests: TFeedSubRequest[] = [
      {
        source: 'local',
        filter: {
          authors: [pubkey],
          kinds: [kinds.Reaction]
        }
      },
      {
        source: 'local',
        filter: {
          '#P': [pubkey],
          kinds: [kinds.Zap]
        }
      }
    ]

    const subscribe = (requests: TFeedSubRequest[]) =>
      client.subscribeTimeline(
        requests,
        { limit: LIMIT },
        {
          onEvents: (events, isFinal) => {
            if (events.length > 0) {
              setEvents(events)
            }
            if (isFinal) {
              setUntil(events.length > 0 ? events[events.length - 1].created_at - 1 : undefined)
              setLoading(false)
            }
          },
          onNew: handleNewEvent
        }
      )

    subc = subscribe(localSubRequests)

    // Then add relay sources when relay list is available
    ;(async () => {
      const relayList = await client.fetchRelayList(pubkey)

      subc?.close()

      // Zap receipts are published by the recipient's lnurl server, so also check big relays
      const zapRelayUrls = Array.from(
        new Set([...relayList.write, ...window.fevela.universe.bigRelayUrls])
      )

      const fullSubRequests: TFeedSubRequest[] = [
        {
          source: 'relays',
          urls: relayList.write,
          filter: {
            authors: [pubkey],
            kinds: [kinds.Reaction]
          }
        },
        {
          source: 'relays',
          urls: zapRelayUrls,
          filter: {
            '#P': [pubkey],
            kinds: [kinds.Zap]
          }
        },
        ...localSubRequests
      ]

      setSubRequests(fullSubRequests)
      subc = subscribe(fullSubRequests)
    })()

    return () => subc?.close?.()
  }, [pubkey, refreshCount])

  useEffect(() => {
    if (!pubkey) return

    const handler = (data: Event) => {
      const customEvent = data as CustomEvent<NostrEvent>
      const evt = customEvent.detail
      if (
        matchFilter({ kinds: [kinds.Reaction], authors: [pubkey] }, evt) ||
        matchFilter({ kinds: [kinds.Zap], '#P': [pubkey] }, evt)
      ) {
        handleNewEvent(evt)
      }
    }

    client.addEventListener('newEvent', handler)
    return () => {
      client.removeEventListener('newEvent', handler)
    }
  }, [pubkey])

  useEffect(() => {
    const options = {
      root: null,
      rootMargin: '10px',
      threshold: 1
    }

    const loadMore = async () => {
      setShowCount((count) => {
        if (filteredItems.length - showCount <= LIMIT / 2) {
          preloadMore()
        }
        return count + SHOW_COUNT
      })

      async function preloadMore() {
        if (!pubkey || subRequests.length === 0 || !until || loading) return

        setLoading(true)
        const newEvents = await client.loadMoreTimeline(subRequests, { until, limit: LIMIT })
        setLoading(false)
        if (newEvents.length === 0) {
          setUntil(undefined)
          return
        }

        setEvents((old) => [...old, ...newEvents])
        setUntil(newEvents[newEvents.length - 1].created_at - 1)
      }
    }

    const observerInstance = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        loadMore()
      }
    }, options)

    const currentBottomRef = bottomRef.current

    if (currentBottomRef) {
      observerInstance.observe(currentBottomRef)
    }

    return () => {
      if (observerInstance && currentBottomRef) {
        observerInstance.unobserve(currentBottomRef)
      }
    }
  }, [pubkey, filteredItems, subRequests, until, loading])

  const refresh = () => {
    topRef.current?.scrollIntoView({ behavior: 'instant', block: 'start' })
    setTimeout(() => {
      setRefreshCount((count) => count + 1)
    }, 500)
  }

  if (!pubkey) return null

  const list = (
    <div className={notificationListStyle === NOTIFICATION_LIST_STYLE.COMPACT ? 'pt-2' : ''}>
      {filteredItems.slice(0, showCount).map((event) => (
        <MyReactionItem key={event.id} event={event} myPubkey={pubkey} />
      ))}
      <div className="text-center text-sm text-muted-foreground">
        {until || loading ? (
          <div ref={bottomRef}>
            <NotificationSkeleton />
          </div>
        ) : (
          t('no more reactions')
        )}
      </div>
    </div>
  )

  return (
    <div>
      <div className="sticky flex items-center justify-between top-12 bg-background z-30 px-4 py-2 w-full border-b gap-3">
        <div
          tabIndex={0}
          className="relative flex w-full items-center rounded-md border border-input px-3 py-1 text-base transition-colors md:text-sm [&:has(:focus-visible)]:ring-ring [&:has(:focus-visible)]:ring-1 [&:has(:focus-visible)]:outline-none bg-surface-background shadow-inner h-full border-none"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="lucide lucide-search size-4 shrink-0 opacity-50"
          >
            <circle cx="11" cy="11" r="8"></circle>
            <path d="m21 21-4.3-4.3"></path>
          </svg>

          <Input
            type="text"
            placeholder={t('Filter by emoji or content...')}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            showClearButton={true}
            onClear={() => setSearchInput('')}
            className="flex-1 h-9 size-full shadow-none border-none bg-transparent focus:outline-none focus-visible:outline-none focus-visible:ring-0 placeholder:text-muted-foreground"
          />
        </div>
        {!supportTouch && <RefreshButton onClick={() => refresh()} />}
      </div>
      <div ref={topRef} className="scroll-mt-[calc(6rem+1px)]" />
      {supportTouch ? (
        <PullToRefresh
          onRefresh={async () => {
            refresh()
            await new Promise((resolve) => setTimeout(resolve, 1000))
          }}
          pullingContent=""
        >
          {list}
        </PullToRefresh>
      ) : (
        list
      )}
    </div>
  )

  function handleNewEvent(event: NostrEvent) {
    setEvents((oldEvents) => {
      const index = oldEvents.findIndex((oldEvent) => compareEvents(oldEvent, event) <= 0)
      if (index !== -1 && oldEvents[index].id === event.id) {
        return oldEvents
      }

      if (index === -1) {
        return [...oldEvents, event]
      }
      return [...oldEvents.slice(0, index), event, ...oldEvents.slice(index)]
    })
  }
})

MyReactionsList.displayName = 'MyReactionsList'
export default MyReactionsList
