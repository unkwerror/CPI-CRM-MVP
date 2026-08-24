import { PersonPageClient } from './person-page-client';

function safeReturnTo(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || (candidate !== '/participants' && !candidate.startsWith('/participants?'))) {
    return '/participants';
  }
  return candidate;
}

export default async function PersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  return <PersonPageClient id={id} returnTo={safeReturnTo(query.returnTo)} />;
}
