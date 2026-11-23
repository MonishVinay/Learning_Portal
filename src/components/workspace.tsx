'use client';
import { useState } from 'react';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import { usePortal } from './shell';
import { Dashboard, WeeklySummary } from './dashboard';
import { Assignments } from './assignments';
import { Exams } from './exams';
import { Briefs } from './briefs';
import { Students } from './students';
import { Revision } from './revision';
import { Settings } from './settings';
import { Archive, Focus, Notifications } from './other';
export function Workspace({section}: {section:string}) {
  const{data,loading,error,refresh,user}=usePortal();
  const[params]=useState(()=>typeof window==='undefined'?new URLSearchParams():new URLSearchParams(window.location.search));
  if(section==='settings')return <Settings/>;
  if(user.mustChangePassword)return <div className="loading-state"><LoaderCircle className="spin"/>Opening password settings…</div>;
  if(loading&&!data)return <div className="workspace-loading" role="status"><div className="skeleton skeleton-title"/><div className="skeleton skeleton-banner"/><div className="stats-grid">{[1,2,3,4].map(n=><div className="skeleton skeleton-stat" key={n}/>)}</div><span><LoaderCircle size={17} className="spin"/>Gathering your workspace…</span></div>;
  if(error)return <div className="card load-error"><h2>Let’s try that again.</h2><p>{error}</p><button className="btn primary" onClick={refresh}><RefreshCw size={17}/>Reload workspace</button></div>;
  if(!data)return null;
  switch(section){case'dashboard':return <><Dashboard/><WeeklySummary/></>;case'assignments':return <Assignments initialOpen={params.get('open')||undefined} initialCreate={params.get('create')==='1'}/>;case'exams':return <Exams/>;case'briefs':return <Briefs/>;case'students':return <Students/>;case'revision':return <Revision/>;case'archive':return <Archive/>;case'notifications':return <Notifications/>;case'focus':return <Focus/>;default:return null;}
}
