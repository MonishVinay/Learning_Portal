'use client';
import { useState } from 'react';
import { BookOpen, Check, Eye, EyeOff, ShieldCheck, Sparkles } from 'lucide-react';
import { api } from '@/lib/client';
export function Login() {
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const [visible,setVisible] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(''); setBusy(true);
    const f = new FormData(e.currentTarget);
    try { const r = await api<{user: {mustChangePassword: boolean}}>('login', {username: f.get('username'), password: f.get('password')}); window.location.assign(r.user.mustChangePassword ? '/settings' : '/dashboard'); }
    catch(e) {setError((e as Error).message); setBusy(false);}
  }
  return <main className="login-page"><section className="login-story"><div className="brand light"><span className="brand-icon"><BookOpen size={25}/></span><span>scholar<span className="brand-dot">.</span></span></div><div className="login-story-content"><div className="eyebrow light-text"><span className="tiny-line"/> A LITTLE PROGRESS, EVERY DAY</div><h1>Good learning.<br/>Great possibilities.</h1><p>A shared space for clear goals, thoughtful feedback, and everything that comes next.</p><div className="login-preview"><div className="preview-top"><span className="icon-tile"><Sparkles size={22}/></span><span>Your next chapter starts here<small>One focused step at a time.</small></span></div>{['Keep your learning organized', 'Make progress visible', 'Stay connected to your teacher'].map(t=><div className="preview-check" key={t}><Check size={17}/>{t}</div>)}</div></div><div className="login-bottom">Purposeful learning. Meaningful progress.</div><div className="orb orb-one"/><div className="orb orb-two"/></section><section className="login-form-side"><div className="login-form-wrap"><span className="pill"><ShieldCheck size={14}/> YOUR PRIVATE LEARNING SPACE</span><h2>Welcome back</h2><p className="muted">Sign in to pick up where you left off.</p><form onSubmit={submit} className="form-stack"><label>Username<input name="username" autoComplete="username" placeholder="Enter your username" required maxLength={64}/></label><label>Password<div className="password-field"><input type={visible ? 'text' : 'password'} name="password" autoComplete="current-password" placeholder="Enter your password" required maxLength={200}/><button type="button" aria-label={visible ? 'Hide password' : 'Show password'} onClick={()=>setVisible(!visible)}>{visible ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div></label>{error && <div className="alert error" role="alert">{error}</div>}<button className="btn primary wide" disabled={busy}>{busy ? 'Signing in…' : 'Sign in to Scholar'}</button></form><div className="login-help">Student accounts are created by your teacher.<br/>Need help signing in? Contact your teacher.</div></div><div className="login-footer">Built for focus. Designed for growth.</div></section></main>;
}
