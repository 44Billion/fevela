import MyReactionsList from '@/components/MyReactionsList'
import PrimaryPageLayout from '@/layouts/PrimaryPageLayout'
import { usePrimaryPage } from '@/PageManager'
import { Heart } from 'lucide-react'
import { forwardRef, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

const MyReactionsPage = forwardRef((_, ref) => {
  const { current } = usePrimaryPage()
  const firstRenderRef = useRef(true)
  const listRef = useRef<{ refresh: () => void }>(null)

  useEffect(() => {
    if (current === 'reactions' && !firstRenderRef.current) {
      listRef.current?.refresh()
    }
    firstRenderRef.current = false
  }, [current])

  return (
    <PrimaryPageLayout
      ref={ref}
      pageName="reactions"
      titlebar={<MyReactionsPageTitlebar />}
      displayScrollToTopButton
    >
      <MyReactionsList ref={listRef} />
    </PrimaryPageLayout>
  )
})
MyReactionsPage.displayName = 'MyReactionsPage'
export default MyReactionsPage

function MyReactionsPageTitlebar() {
  const { t } = useTranslation()

  return (
    <div className="flex gap-2 items-center h-full pl-3">
      <Heart />
      <div className="text-lg font-semibold">{t('My reactions')}</div>
    </div>
  )
}
