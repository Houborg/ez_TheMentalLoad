"use client";

import {
  Calendar,
  Home,
  Users,
  Bell,
  Settings,
  Plus,
  CalendarDays,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

const mainNavItems = [
  { icon: Home, label: "Dashboard", active: true },
  { icon: Calendar, label: "Calendar", active: false },
  { icon: CalendarDays, label: "Schedule", active: false },
  { icon: Users, label: "Family", active: false },
];

const settingsNavItems = [
  { icon: Bell, label: "Notifications", active: false },
  { icon: Settings, label: "Settings", active: false },
];

const familyMembers = [
  { name: "Sarah", initials: "SA", color: "bg-primary" },
  { name: "Tom", initials: "TO", color: "bg-chart-2" },
  { name: "Emma", initials: "EM", color: "bg-chart-3" },
  { name: "Max", initials: "MA", color: "bg-chart-5" },
];

export function DashboardSidebar() {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-3 group-data-[collapsible=icon]:justify-center">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <CalendarDays className="h-5 w-5" />
          </div>
          <div className="flex flex-col group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-semibold tracking-tight">
              Family Calendar
            </span>
            <span className="text-xs text-muted-foreground">Stay organized</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNavItems.map((item) => (
                <SidebarMenuItem key={item.label}>
                  <SidebarMenuButton
                    isActive={item.active}
                    tooltip={item.label}
                    className="gap-3"
                  >
                    <item.icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        <SidebarGroup>
          <SidebarGroupLabel className="text-xs uppercase tracking-wider text-muted-foreground">
            Family Members
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <div className="flex flex-col gap-2 px-2 group-data-[collapsible=icon]:items-center">
              {familyMembers.map((member) => (
                <div
                  key={member.name}
                  className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent transition-colors cursor-pointer group-data-[collapsible=icon]:px-0"
                >
                  <Avatar className="h-7 w-7">
                    <AvatarFallback
                      className={`${member.color} text-primary-foreground text-xs`}
                    >
                      {member.initials}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm group-data-[collapsible=icon]:hidden">
                    {member.name}
                  </span>
                </div>
              ))}
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-3 text-muted-foreground hover:text-foreground group-data-[collapsible=icon]:w-auto group-data-[collapsible=icon]:justify-center"
              >
                <Plus className="h-4 w-4" />
                <span className="group-data-[collapsible=icon]:hidden">
                  Add member
                </span>
              </Button>
            </div>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {settingsNavItems.map((item) => (
                <SidebarMenuItem key={item.label}>
                  <SidebarMenuButton tooltip={item.label} className="gap-3">
                    <item.icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4">
        <div className="flex items-center gap-3 group-data-[collapsible=icon]:justify-center">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-accent text-accent-foreground text-xs">
              JD
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-medium">John Doe</span>
            <span className="text-xs text-muted-foreground">Admin</span>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
