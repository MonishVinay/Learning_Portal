'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Archive, Bell, BookOpen, CalendarDays, ChevronRight, CircleHelp, ClipboardList, GraduationCap, LayoutDashboard, LogOut, Menu, Moon, PanelLeftClose, Search, Settings, Sun, Target, Timer, Users, X } from 'lucide-react';
import { api } from '@/lib/client';
import type { PortalData, PortalUser } from '@/lib/types';
type Context = {user: PortalUser; setUser: (u: PortalUser) => void; data: PortalData | null; loading: boolean; error: string; refresh: () => Promise<void>; toast: (s: string) => void};
const PortalContext = createContext<Context | null>(null);
export function usePortal() {const value = useContext(PortalContext); if(!value) throw new Error('Portal context missing'); return value;}
export function PortalShell({user: initialUser, children}: {user: PortalUser; children: React.ReactNode}) {
  const [user,setUser] = useState(initialUser);
  const [data,setData] = useState<PortalData | null>(null);
  const [loading,setLoading] = useState(!user.mustChangePassword);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [open,setOpen] = useState(false);
  const [dark,setDark] = useState(false);
  const pathname = usePathname();
  const teacher = user.role === 'TEACHER';
  const refresh = useCallback(async()=>{if(user.mustChangePassword) return; setError(''); try {setData(await api<PortalData>('data'));} catch(e) {setError((e as Error).message);} finally {setLoading(false);}},[user.mustChangePassword]);
  useEffect(()=>{void refresh();},[refresh]);
  useEffect(()=>{const saved = localStorage.getItem('scholar-theme') === 'dark'; setDark(saved); document.documentElement.dataset.theme = saved ? 'dark' : 'light';},[]);
  useEffect(()=>{if(user.mustChangePassword && pathname !== '/settings') window.location.replace('/settings');},[user.mustChangePassword,pathname]);
  useEffect(()=>{if(!notice)return; const t=setTimeout(()=>setNotice(''),4500);return()=>clearTimeout(t);},[notice]);
  const links = [
    {href:'/dashboard',name:'Overview',icon:LayoutDashboard}, {href:'/assignments',name:'Assignments',icon:ClipboardList},
    {href:'/exams',name:'Exams & reports',icon:GraduationCap}, {href:'/briefs',name:'Daily briefs',icon:CalendarDays},
    ...(teacher ? [{href:'/students',name:'Students',icon:Users}] : []),
    {href:'/revision',name:'Mistakes & revision',icon:Target},
    ...(!teacher ? [{href:'/focus',name:'Focus timer',icon:Timer}] : []), {href:'/archive',name:'Archive',icon:Archive},
  ];
  const unread = data?.notifications.filter(n=>!n.read).length ?? 0;
  async function logout(){try {await api('logout',{}); localStorage.removeItem('scholar-theme'); window.location.assign('/login');}catch(e){setNotice((e as Error).message);}}
  function theme(){setDark(!dark);localStorage.setItem('scholar-theme',dark?'light':'dark');document.documentElement.dataset.theme=dark?'light':'dark';}
  const label = links.find(l=>pathname===l.href)?.name || (pathname==='/settings'?'Settings':'Notifications');
  return <PortalContext.Provider value={{user,setUser,data,loading,error,refresh,toast:setNotice}}><div className="app-shell">{open && <button className="nav-scrim" aria-label="Close navigation" onClick={()=>setOpen(false)}/>}<aside className={`sidebar ${open?'is-open':''}`}><Link href="/dashboard" className="brand"><span className="brand-icon"><BookOpen size={24}/></span><span>scholar<span className="brand-dot">.</span></span></Link><button className="mobile-close icon-button" onClick={()=>setOpen(false)} aria-label="Close navigation"><PanelLeftClose size={20}/></button><div className="workspace-label"><span className="workspace-avatar">{teacher?'T':'S'}</span><span>{teacher?'Teaching workspace':'Learning workspace'}<small>Personal workspace</small></span><ChevronRight size={15}/></div><div className="nav-caption">WORKSPACE</div><nav>{links.map(l=><Link className={`nav-link ${pathname===l.href?'active':''}`} href={l.href} key={l.href} onClick={()=>setOpen(false)}><l.icon size={19}/>{l.name}{l.href==='/assignments' && !!data?.assignments.length && <span className="nav-count">{data.assignments.filter(a=>!a.isTemplate).length}</span>}</Link>)}</nav><div className="sidebar-bottom"><div className="sidebar-note"><span className="note-icon"><BookOpen size={20}/></span><strong>Small steps. Lasting progress.</strong><p>Make room for a little learning every day.</p></div><Link href="/settings" className={`nav-link ${pathname==='/settings'?'active':''}`} onClick={()=>setOpen(false)}><Settings size={19}/>Settings</Link><button onClick={logout} className="nav-link"><LogOut size={19}/>Sign out</button><div className="sidebar-profile"><span className="avatar">{user.name.slice(0,2).toUpperCase()}</span><span><strong>{user.name}</strong><small>{teacher?'Teacher account':'Student account'}</small></span><span className="account-dot"/></div></div></aside><div className="app-main"><header className="topbar"><div className="breadcrumb"><button className="mobile-menu icon-button" aria-label="Open navigation" onClick={()=>setOpen(true)}><Menu size={22}/></button><span className="breadcrumb-workspace">Workspace</span><ChevronRight size={14}/><strong>{label}</strong></div><div className="topbar-actions"><Link href="/archive" className="search-link"><Search size={17}/><span>Search your workspace</span><kbd>⌕</kbd></Link><button className="icon-button" onClick={theme} aria-label={dark?'Use light theme':'Use dark theme'}>{dark?<Sun size={19}/>:<Moon size={19}/>}</button><Link className="icon-button notification-button" href="/notifications" aria-label={`Notifications, ${unread} unread`}><Bell size={20}/>{unread>0&&<i/>}</Link><span className="topbar-divider"/><Link className="avatar" href="/settings" aria-label="Account settings">{user.name.slice(0,2).toUpperCase()}</Link></div></header><main className="page-content">{children}</main><footer className="workspace-footer"><span>Scholar · A little better, every day.</span><span><CircleHelp size={13}/> {user.timezone}</span></footer></div>{notice&&<div className="toast" role="status">{notice}<button aria-label="Dismiss notification" onClick={()=>setNotice('')}><X size={16}/></button></div>}</div></PortalContext.Provider>;
}
