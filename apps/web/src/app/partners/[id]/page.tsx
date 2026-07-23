import { PartnerPageClient } from './partner-page-client';

export default async function PartnerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PartnerPageClient id={id} />;
}
