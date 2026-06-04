import { Icon, type IconName } from "@/components/icon";

/**
 * Consistent "this screen arrives in a later ticket" card for routes whose full
 * build lives in a not-yet-implemented story. Sits inside the real app shell.
 */
export function ScreenPlaceholder({
  icon = "box",
  title,
  children,
}: {
  icon?: IconName;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="card" style={{ maxWidth: 540 }}>
      <div
        className="empty-ico"
        style={{
          background: "var(--primary-tint)",
          color: "var(--primary)",
          marginBottom: 16,
        }}
      >
        <Icon name={icon} />
      </div>
      <h2 className="h2" style={{ marginBottom: 6 }}>
        {title}
      </h2>
      <p className="text-muted body" style={{ margin: 0 }}>
        {children}
      </p>
    </div>
  );
}
