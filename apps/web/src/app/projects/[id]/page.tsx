import { ProjectPageClient } from './project-page-client';

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectPageClient id={id} />;
}
