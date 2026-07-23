import { PersonPageClient } from './person-page-client';

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PersonPageClient id={id} />;
}
