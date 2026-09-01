import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { DashboardHeader } from "@/components/dashboard-header";
import { PersonalityOnboardingDialog } from "@/components/personality-onboarding-dialog";

// Dashboard pages read SQLite at request time — skip static prerender during `next build`.
export const dynamic = "force-dynamic";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <DashboardHeader />
        <main className="flex-1 overflow-auto p-6 min-w-0">{children}</main>
        <PersonalityOnboardingDialog />
      </SidebarInset>
    </SidebarProvider>
  );
}
