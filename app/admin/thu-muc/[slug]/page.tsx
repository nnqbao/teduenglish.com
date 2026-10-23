import FolderDetail from "@/components/admin/FolderDetail";

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <FolderDetail key={slug} slug={decodeURIComponent(slug)} />;
}
