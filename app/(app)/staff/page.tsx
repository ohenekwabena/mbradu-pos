import { NotOwner } from "@/components/shell/not-owner";
import { getCurrentProfile } from "@/lib/dal";
import { getStaffRoster } from "@/lib/staff";
import { ResetPasswordButton } from "./reset-password-button";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

export default async function StaffPage() {
  const profile = await getCurrentProfile();
  if (profile.role !== "owner") {
    return <NotOwner message="Only the Owner can manage staff." />;
  }

  const roster = await getStaffRoster();

  return (
    <div className="stack gap-16">
      <div className="card" style={{ padding: 0 }}>
        <div
          className="card-head"
          style={{
            padding: "20px 24px 0",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: 2,
          }}
        >
          <h2 className="h2">People</h2>
          <span className="caption text-faint">
            Cashiers can&apos;t change their own password — use{" "}
            <strong>Reset password</strong> to send them a fresh link.
          </span>
        </div>
        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Shop</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {roster.map((member) => {
                const isOwner = member.role === "owner";
                return (
                  <tr key={member.id}>
                    <td>
                      <div className="row gap-12">
                        <span className="avatar">{initials(member.name)}</span>
                        <span className="body-med">{member.name}</span>
                      </div>
                    </td>
                    <td className="text-muted">{member.email}</td>
                    <td>
                      <span
                        className={`chip ${isOwner ? "chip-primary" : "chip-neutral"}`}
                      >
                        {isOwner ? "Owner" : "Cashier"}
                      </span>
                    </td>
                    <td className={isOwner ? "text-faint" : undefined}>
                      {isOwner ? "— All shops" : (member.shopName ?? "—")}
                    </td>
                    <td>
                      <span className="chip chip-success">Active</span>
                    </td>
                    <td className="num">
                      {!isOwner && (
                        <div
                          className="row"
                          style={{ gap: 2, justifyContent: "flex-end" }}
                        >
                          <ResetPasswordButton
                            name={member.name}
                            email={member.email}
                          />
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3 className="h3" style={{ marginBottom: 4 }}>
          More staff tools are on the way
        </h3>
        <p className="text-muted caption" style={{ margin: 0 }}>
          Inviting cashiers into a shop, reassigning shops, and deactivation
          arrive in a later ticket (MP-27–MP-29).
        </p>
      </div>
    </div>
  );
}
