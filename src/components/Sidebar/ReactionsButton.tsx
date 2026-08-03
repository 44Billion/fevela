import { usePrimaryPage } from '@/PageManager'
import { useNostr } from '@/providers/NostrProvider'
import { Heart } from 'lucide-react'
import SidebarItem from './SidebarItem'

export default function ReactionsButton({ collapse }: { collapse: boolean }) {
  const { checkLogin } = useNostr()
  const { navigate, current, display } = usePrimaryPage()

  return (
    <SidebarItem
      title="My reactions"
      onClick={() => checkLogin(() => navigate('reactions'))}
      active={display && current === 'reactions'}
      collapse={collapse}
    >
      <Heart />
    </SidebarItem>
  )
}
