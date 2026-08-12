import MyReactionsList from '@/components/MyReactionsList'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { forwardRef } from 'react'
import { useTranslation } from 'react-i18next'

const MyReactionsPage = forwardRef(({ index }: { index?: number }, ref) => {
  const { t } = useTranslation()

  return (
    <SecondaryPageLayout index={index} title={t('My reactions')} displayScrollToTopButton ref={ref}>
      <MyReactionsList />
    </SecondaryPageLayout>
  )
})
MyReactionsPage.displayName = 'MyReactionsPage'
export default MyReactionsPage
