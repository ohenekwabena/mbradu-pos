import { NotOwner } from "@/components/shell/not-owner";
import { ScreenPlaceholder } from "@/components/shell/screen-placeholder";
import { getCurrentProfile } from "@/lib/dal";

export default async function StaffPage() {
  const profile = await getCurrentProfile();
  if (profile.role !== "owner") {
    return <NotOwner message="Only the Owner can manage staff." />;
  }

  return (
    <ScreenPlaceholder icon="staff" title="Staff">
      Inviting Cashiers into a Shop, reassignment, and password resets arrive in
      a later ticket (MP-27–MP-29).
    </ScreenPlaceholder>
  );
}
