import PublicProfilePage from "../../../components/PublicProfilePage";

export default async function UserPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  return <PublicProfilePage username={username} />;
}
