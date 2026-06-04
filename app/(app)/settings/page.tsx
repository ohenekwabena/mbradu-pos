import { NotOwner } from "@/components/shell/not-owner";
import { ScreenPlaceholder } from "@/components/shell/screen-placeholder";
import { getCurrentProfile } from "@/lib/dal";

export default async function SettingsPage() {
  const profile = await getCurrentProfile();
  if (profile.role !== "owner") {
    return <NotOwner message="Only the Owner can change settings." />;
  }

  return (
    <ScreenPlaceholder icon="settings" title="Settings">
      The business-wide low-stock threshold, expiry window, and currency arrive
      in a later ticket.
    </ScreenPlaceholder>
  );
}
