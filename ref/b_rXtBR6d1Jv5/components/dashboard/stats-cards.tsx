"use client";

import { Calendar, Users, Clock, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatCard {
  label: string;
  value: string;
  subtext: string;
  icon: React.ElementType;
  trend?: "up" | "down" | "neutral";
  color: string;
}

const stats: StatCard[] = [
  {
    label: "Total Events",
    value: "24",
    subtext: "This month",
    icon: Calendar,
    color: "text-primary bg-primary/10",
  },
  {
    label: "Family Members",
    value: "4",
    subtext: "Active",
    icon: Users,
    color: "text-chart-2 bg-chart-2/10",
  },
  {
    label: "Upcoming",
    value: "8",
    subtext: "Next 7 days",
    icon: Clock,
    color: "text-chart-3 bg-chart-3/10",
  },
  {
    label: "Completed",
    value: "16",
    subtext: "This month",
    icon: CheckCircle2,
    color: "text-chart-5 bg-chart-5/10",
  },
];

export function StatsCards() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat) => (
        <Card
          key={stat.label}
          className="border-border/50 bg-card/50 backdrop-blur-sm hover:bg-card/80 transition-colors"
        >
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground font-medium">
                  {stat.label}
                </span>
                <span className="text-2xl font-bold tracking-tight">
                  {stat.value}
                </span>
                <span className="text-xs text-muted-foreground">
                  {stat.subtext}
                </span>
              </div>
              <div className={cn("p-2 rounded-lg", stat.color)}>
                <stat.icon className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
