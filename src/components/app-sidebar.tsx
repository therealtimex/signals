"use client";

import {
  LayoutDashboard,
  Users,
  FileText,
  Zap,
  BarChart3,
  Target,
  Settings,
  BookOpen,
  HelpCircle,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

const navItems = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { title: "Contacts", href: "/dashboard/contacts", icon: Users },
  { title: "Content", href: "/dashboard/content", icon: FileText },
  { title: "Automation", href: "/dashboard/workflows", icon: Zap },
  { title: "Analytics", href: "/dashboard/analytics", icon: BarChart3 },
  { title: "Goals", href: "/dashboard/goals", icon: Target },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border px-6 py-4">
        <Link href="/dashboard" className="flex items-center gap-3">
          <Image
            src="/favicon-32x32.png"
            alt="Signals"
            width={32}
            height={32}
            className="rounded-lg"
          />
          <span className="text-lg font-bold text-gradient-brand font-display">
            Signals
          </span>
        </Link>
      </SidebarHeader>
      <SidebarContent className="bg-sidebar/30 backdrop-blur-sm">
        <SidebarGroup>
          <SidebarGroupLabel className="text-label text-muted-foreground px-4">
            Navigation
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive =
                  item.href === "/dashboard"
                    ? pathname === "/dashboard"
                    : pathname.startsWith(item.href);

                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      className={cn(
                        "font-display font-medium transition-all duration-200",
                        isActive &&
                          "border-l-2 border-primary bg-primary/8 text-primary"
                      )}
                    >
                      <Link href={item.href}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={pathname === "/dashboard/settings"}
              className={cn(
                "font-display font-medium transition-all duration-200",
                pathname === "/dashboard/settings" &&
                  "border-l-2 border-primary bg-primary/8 text-primary"
              )}
            >
              <Link href="/dashboard/settings">
                <Settings className="h-4 w-4" />
                <span>Settings</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={pathname.startsWith("/dashboard/guide")}
              className={cn(
                "font-display font-medium transition-all duration-200",
                pathname.startsWith("/dashboard/guide") &&
                  "border-l-2 border-primary bg-primary/8 text-primary"
              )}
            >
              <Link href="/dashboard/guide">
                <BookOpen className="h-4 w-4" />
                <span>Guide</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={pathname === "/dashboard/help"}
              className={cn(
                "font-display font-medium transition-all duration-200",
                pathname === "/dashboard/help" &&
                  "border-l-2 border-primary bg-primary/8 text-primary"
              )}
            >
              <Link href="/dashboard/help">
                <HelpCircle className="h-4 w-4" />
                <span>Help</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
