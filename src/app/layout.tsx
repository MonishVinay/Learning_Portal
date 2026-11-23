import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {title: {default: 'Scholar · Learning, thoughtfully connected', template: '%s · Scholar'}, description: 'A focused workspace for teachers and students. Assignments, progress, daily briefs and meaningful feedback.'};
export default function RootLayout({children}: {children: React.ReactNode}) {
  return <html lang="en" suppressHydrationWarning><body>{children}</body></html>;
}
