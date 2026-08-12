import Emoji from '@/components/Emoji'
import { useFetchEvent } from '@/hooks'
import { getZapInfoFromEvent } from '@/lib/event-metadata'
import { formatAmount } from '@/lib/lightning'
import { generateBech32IdFromATag, generateBech32IdFromETag, tagNameEquals } from '@/lib/tag'
import { parseReactionEmoji } from '@/services/note-stats.service'
import { Event } from '@nostr/tools/wasm'
import * as kinds from '@nostr/tools/kinds'
import { Zap } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Notification from '../NotificationList/NotificationItem/Notification'

export function getMyReactionTargetId(event: Event): string | undefined {
  if (event.kind === kinds.Reaction) {
    const aTag = event.tags.findLast(tagNameEquals('a'))
    if (aTag) {
      return generateBech32IdFromATag(aTag)
    }
    const eTag = event.tags.findLast(tagNameEquals('e'))
    return eTag ? generateBech32IdFromETag(eTag) : undefined
  }
  if (event.kind === kinds.Zap) {
    return getZapInfoFromEvent(event)?.eventId
  }
  return undefined
}

export function MyReactionItem({ event, myPubkey }: { event: Event; myPubkey: string }) {
  if (event.kind === kinds.Reaction) {
    return <MyLikeItem event={event} />
  }
  if (event.kind === kinds.Zap) {
    return <MyZapItem event={event} myPubkey={myPubkey} />
  }
  return null
}

function MyLikeItem({ event }: { event: Event }) {
  const { t } = useTranslation()
  const targetId = useMemo(() => getMyReactionTargetId(event), [event])
  const { event: targetEvent } = useFetchEvent(targetId)

  if (!targetEvent) {
    return null
  }

  return (
    <Notification
      notificationId={event.id}
      icon={
        <div className="text-xl min-w-6 flex justify-center">
          <Emoji emoji={parseReactionEmoji(event)} classNames={{ img: 'size-6' }} />
        </div>
      }
      sender={targetEvent.pubkey}
      sentAt={event.created_at}
      targetEvent={targetEvent}
      description={t('received your reaction')}
    />
  )
}

function MyZapItem({ event, myPubkey }: { event: Event; myPubkey: string }) {
  const { t } = useTranslation()
  const info = useMemo(() => getZapInfoFromEvent(event), [event])
  const { event: targetEvent } = useFetchEvent(info?.eventId)

  if (!info || info.senderPubkey !== myPubkey || !targetEvent) {
    return null
  }

  return (
    <Notification
      notificationId={event.id}
      icon={<Zap size={24} className="text-yellow-400 shrink-0" />}
      sender={targetEvent.pubkey}
      sentAt={event.created_at}
      targetEvent={targetEvent}
      middle={
        <div className="font-semibold text-yellow-400 truncate">
          {formatAmount(info.amount)} {t('sats')} {info.comment}
        </div>
      }
      description={t('received your zap')}
    />
  )
}
