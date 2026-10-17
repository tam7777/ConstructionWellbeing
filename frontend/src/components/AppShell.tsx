import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { LayoutGrid, Film, Upload, Brain, HeartHandshake, ChevronDown, Search, HardHat } from 'lucide-react'
import { cn } from '@/lib/utils'

// Adapted from londrwus/hack2's AppShell, using its original visual system.
const groups = [
  {label: 'Workspace', items: [{to: '/', label: 'Overview', icon: LayoutGrid}, {to: '/clips', label: 'Clips', icon: Film}]},
  {label: 'Work', items: [{to: '/upload', label: 'Analyse', icon: Upload}, {to: '/model', label: 'Models', icon: Brain}]},
]
export default function AppShell({children}: {children: React.ReactNode}) {
  const [q,setQ] = useState('')
  const nav = useNavigate()
  return <div className="flex min-h-screen bg-canvas">
    <aside className="sitesense-sidebar sticky top-0 flex h-screen w-[204px] shrink-0 flex-col gap-6 px-3 py-5">
      <NavLink to="/" aria-label="SiteSense home" title="SiteSense" className="flex items-center gap-2.5 px-2">
        <div className="grid size-8 place-items-center rounded-[10px] bg-ink text-white"><HardHat className="size-4" /></div>
        <div className="leading-tight"><div className="text-base font-semibold tracking-tight text-ink">SiteSense</div><div className="mt-0.5 text-[11px] text-muted-foreground">Worker wellbeing</div></div>
      </NavLink>
      <form onSubmit={e => {e.preventDefault(); nav('/clips?q='+encodeURIComponent(q))}} className="flex h-9 items-center gap-2 rounded-[10px] border border-hairline bg-white px-2.5">
        <Search className="size-4 text-muted-foreground"/><input value={q} onChange={e=>setQ(e.target.value)} aria-label="Search footage" placeholder="Search footage" className="min-w-0 flex-1 bg-transparent text-xs outline-none" />
      </form>
      <nav className="space-y-6">{groups.map(group=><div key={group.label}>
        <div className="mb-2 flex items-center gap-1 px-2.5 text-[11px] text-muted-foreground">{group.label}<ChevronDown className="size-3"/></div>
        <div className="space-y-1">{group.items.map(item=>{const Icon=item.icon;return <NavLink key={item.to} to={item.to} aria-label={item.label} title={item.label} end={item.to==='/'} className={({isActive})=>cn('flex h-9 items-center gap-2.5 rounded-[10px] border px-2.5 text-sm transition-colors',isActive?'border-hairline bg-white font-medium text-ink shadow-soft':'border-transparent text-muted-foreground hover:text-ink')}><Icon className="size-4" strokeWidth={1.5}/><span>{item.label}</span></NavLink>})}</div>
      </div>)}</nav>
      <div className="mt-auto rounded-[14px] border border-hairline bg-white p-3 shadow-soft"><HeartHandshake className="mb-2 size-5 text-teal"/><p className="text-xs font-medium">A prompt to check in</p><p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">Review the footage. Speak to the person.</p></div>
      <div className="flex items-center gap-2.5 px-2"><div className="grid size-8 place-items-center rounded-full bg-white text-[11px] font-medium">SS</div><div className="text-xs"><div>Site supervisor</div><div className="mt-0.5 text-[10px] text-muted-foreground">Recorded footage</div></div></div>
    </aside>
    <main className="min-w-0 flex-1 px-6 pt-6 pb-12">{children}</main>
  </div>
}
