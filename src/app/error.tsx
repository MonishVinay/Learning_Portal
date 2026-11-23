'use client';
export default function ErrorPage({reset}: {reset: () => void}) { return <main className="error-page"><h1>We couldn’t load this page.</h1><p>Check your connection and try again. Saved records are kept in your database.</p><button className="btn primary" onClick={reset}>Try again</button></main>; }
