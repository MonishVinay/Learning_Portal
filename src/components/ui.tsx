'use client';
import { useEffect, useRef, useState } from 'react';
import { CircleCheck, FileText, LoaderCircle, UploadCloud, X } from 'lucide-react';
import { api } from '@/lib/client';
import { inferFileMime } from '@/lib/domain';
import type { Asset } from '@/lib/types';
export function Empty({icon: Icon = FileText, title, children, action}: {icon?: typeof FileText; title: string; children?: React.ReactNode; action?: React.ReactNode}) {
  return <div className="empty"><span className="empty-icon"><Icon size={27}/></span><h3>{title}</h3><p>{children}</p>{action}</div>;
}
export function Badge({children, tone = 'neutral'}: {children: React.ReactNode; tone?: string}) {return <span className={`badge ${tone}`}>{children}</span>;}
export function Status({value}: {value: string}) {const tone = ({SUBMITTED: 'blue', CORRECTIONS: 'amber', APPROVED: 'green', GRADED: 'green', OVERDUE: 'red', PENDING: 'neutral', HIGH: 'red', MEDIUM: 'amber', LOW: 'blue', SCHEDULED: 'purple'} as Record<string,string>)[value] || 'neutral'; return <Badge tone={tone}>{value.toLowerCase().replaceAll('_',' ')}</Badge>;}
export function Modal({title, subtitle, children, onClose, wide = false}: {title: string; subtitle?: string; children: React.ReactNode; onClose: () => void; wide?: boolean}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(()=> { const dialog = ref.current; dialog?.showModal(); return ()=>dialog?.close(); },[]);
  return <dialog ref={ref} className={`modal ${wide ? 'modal-wide' : ''}`} onCancel={onClose} onClick={e=>{if(e.target === e.currentTarget) onClose();}}><div className="modal-head"><div><h2>{title}</h2>{subtitle && <p className="muted">{subtitle}</p>}</div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={20}/></button></div><div className="modal-content">{children}</div></dialog>;
}
export function FileLinks({files}: {files: Asset[]}) {return <div className="file-list">{files.map(f=><div className="file-row" key={f.id}><FileText size={19}/><span>{f.name}<small>{(f.size / 1024).toFixed(0)} KB</small></span>{['application/pdf','image/png','image/jpeg'].includes(f.mime) && <a className="text-button" href={`/api/files/${f.id}?preview=1`} target="_blank" rel="noreferrer">Preview</a>}<a className="text-button" href={`/api/files/${f.id}`}>Download</a></div>)}</div>;}
export function Uploads({ownerId, purpose, value, onChange, onBusy}: {ownerId: string; purpose: 'ASSIGNMENT' | 'SUBMISSION' | 'REPORT'; value: Asset[]; onChange: (v: Asset[]) => void; onBusy: (busy: boolean) => void}) {
  const [progress,setProgress] = useState('');
  const [error,setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const current = [...value]; setError(''); onBusy(true);
    try {
      if (files.length + value.length > 12) throw new Error('Attach up to 12 files per save.');
      for (const file of Array.from(files)) {
        setProgress(`Uploading ${file.name}…`);
        const mime = inferFileMime(file.name, file.type);
        const pendingKey = `scholar-upload:${ownerId}:${purpose}:${file.name}:${file.size}:${file.lastModified}`;
        let pending: {id: string; url: string};
        const previous = sessionStorage.getItem(pendingKey);
        if (previous) {
          // A previous PUT might have succeeded even when the response was interrupted.
          try {
            const asset = await api<Asset>(`uploads/${previous}/complete`, {});
            current.push(asset); onChange([...current]); sessionStorage.removeItem(pendingKey); continue;
          } catch { pending = await api(`uploads/${previous}/retry`, {}); }
        } else {
          pending = await api('uploads', {name: file.name, size: file.size, mime, purpose});
          sessionStorage.setItem(pendingKey, pending.id);
        }
        const response = await fetch(pending.url, {method: 'PUT', headers: {'Content-Type': mime, 'x-upsert': 'false'}, body: file});
        // A retried PUT may report an existing object. Trust only server verification.
        if (!response.ok) {
          try {
            const asset = await api<Asset>(`uploads/${pending.id}/complete`, {});
            current.push(asset); onChange([...current]); sessionStorage.removeItem(pendingKey); continue;
          } catch { throw new Error('Upload was interrupted or storage rejected it. Select the file again to retry. Check the private Supabase bucket settings if this continues.'); }
        }
        const asset = await api<Asset>(`uploads/${pending.id}/complete`, {});
        current.push(asset); onChange([...current]); sessionStorage.removeItem(pendingKey);
      }
    } catch(e) {setError((e as Error).message);} finally {onBusy(false); setProgress(''); if(input.current) input.current.value = '';}
  }
  return <div><input className="sr-only" type="file" ref={input} multiple accept={purpose === 'SUBMISSION' ? '.pdf,.png,.jpg,.jpeg,.doc,.docx,.txt' : '.pdf'} onChange={e=>upload(e.target.files)} disabled={!!progress}/><button type="button" className="upload-zone" onClick={()=>input.current?.click()} disabled={!!progress}>{progress ? <LoaderCircle className="spin" size={25}/> : <UploadCloud size={27}/>}<strong>{progress || 'Choose files to upload'}</strong><span>{purpose === 'SUBMISSION' ? 'PDF, JPG, PNG, DOC, DOCX or TXT' : 'PDF files'} · up to 12 files · default 20 MB each</span></button>{value.map(f=><div className="file-row" key={f.id}><CircleCheck size={17} className="success-text"/><span>{f.name}<small>Uploaded · ready to attach</small></span><button type="button" className="icon-button" aria-label={`Remove ${f.name} from draft`} onClick={()=>onChange(value.filter(v=>v.id !== f.id))}><X size={16}/></button></div>)}{error && <p role="alert" className="alert error">{error}</p>}</div>;
}
export function useDraft<T>(key: string, initial: T | (() => T)) {
  const [baseline] = useState<T>(initial);
  const [value,setValue] = useState<T>(baseline);
  const [loaded,setLoaded] = useState(false);
  const latest = useRef(value);
  useEffect(()=>{latest.current=value;},[value]);
  useEffect(()=>{try {const saved = localStorage.getItem(key); if(saved) setValue(JSON.parse(saved));} catch {} setLoaded(true);},[key]);
  useEffect(()=>{if(loaded) {try {localStorage.setItem(key, JSON.stringify(value));} catch {}}},[value,key,loaded]);
  useEffect(()=>{const warn = (e: BeforeUnloadEvent)=>{if(JSON.stringify(latest.current) !== JSON.stringify(baseline)) e.preventDefault();}; window.addEventListener('beforeunload',warn); return ()=>window.removeEventListener('beforeunload',warn);},[baseline]);
  const clear = ()=>{try {localStorage.removeItem(key);} catch {}};
  return [value,setValue,clear] as const;
}
export function FormError({error}: {error: string}) {return error ? <div role="alert" className="alert error">{error}</div> : null;}
