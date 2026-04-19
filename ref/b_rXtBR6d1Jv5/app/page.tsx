"use client";

import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { DashboardSidebar } from "@/components/dashboard/sidebar-nav";
import { DashboardHeader } from "@/components/dashboard/header";
import { CalendarView } from "@/components/dashboard/calendar-view";
import { UpcomingEvents } from "@/components/dashboard/upcoming-events";
import { StatsCards } from "@/components/dashboard/stats-cards";

export default function FamilyCalendarDashboard() {
  return (
    <SidebarProvider>
      <DashboardSidebar />
      <SidebarInset className="flex flex-col">
        <DashboardHeader />
        <main className="flex-1 overflow-auto p-6">
          <div className="max-w-[1600px] mx-auto flex flex-col gap-6">
            <div>
              <h1 className="text-3xl font-bold tracking-tight mb-1">
                Welcome back, John
              </h1>
              <p className="text-muted-foreground">
                {"Here's what's happening with your family this week."}
              </p>
            </div>

            <StatsCards />

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 flex-1 min-h-0">
              <div className="xl:col-span-2 bg-card/50 backdrop-blur-sm rounded-lg border border-border/50 p-4">
                <CalendarView />
              </div>
              <div className="min-h-[500px]">
                <UpcomingEvents />
              </div>
            </div>
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
