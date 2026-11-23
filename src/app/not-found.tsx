import Link from 'next/link';
export default function NotFound() { return <main className="error-page"><h1>Page not found</h1><p>Let’s get you back to your workspace.</p><Link href="/dashboard" className="btn primary">Open dashboard</Link></main>; }
