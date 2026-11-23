import { redirect } from 'next/navigation';
import { getUser, publicUser } from '@/lib/auth';
import { PortalShell } from '@/components/shell';
export const dynamic = 'force-dynamic';
export default async function PortalLayout({children}: {children: React.ReactNode}) {
  const user = await getUser();
  if (!user) redirect('/login');
  return <PortalShell user={JSON.parse(JSON.stringify(publicUser(user)))}>{children}</PortalShell>;
}
