import { PageHeader } from "@/components/dashboard/page-header";
import { SettingsNav } from "@/components/navigation/settings-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <PageHeader title="Settings" description="Your profile, this workspace and how the optimizer behaves." />

      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <SettingsNav />
        <div className="min-w-0 space-y-5">{children}</div>
      </div>
    </div>
  );
}
