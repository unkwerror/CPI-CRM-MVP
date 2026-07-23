import { EventPageClient } from './event-page-client';

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EventPageClient id={id} />;
}
