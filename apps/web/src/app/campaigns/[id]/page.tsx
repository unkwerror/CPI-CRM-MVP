import { CampaignPageClient } from './campaign-page-client';

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CampaignPageClient id={id} />;
}
