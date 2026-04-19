"use client";

import { Clock, MapPin, User } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Event {
  id: string;
  title: string;
  date: string;
  time: string;
  location?: string;
  member: string;
  initials: string;
  color: string;
  category: string;
}

const upcomingEvents: Event[] = [
  {
    id: "1",
    title: "Team Meeting",
    date: "Today",
    time: "10:00 AM",
    location: "Office",
    member: "Sarah",
    initials: "SA",
    color: "bg-primary",
    category: "Work",
  },
  {
    id: "2",
    title: "Doctor Appointment",
    date: "Apr 20",
    time: "2:30 PM",
    location: "City Hospital",
    member: "Tom",
    initials: "TO",
    color: "bg-chart-2",
    category: "Health",
  },
  {
    id: "3",
    title: "Piano Lesson",
    date: "Apr 21",
    time: "4:00 PM",
    location: "Music School",
    member: "Emma",
    initials: "EM",
    color: "bg-chart-3",
    category: "Education",
  },
  {
    id: "4",
    title: "Soccer Practice",
    date: "Apr 22",
    time: "5:30 PM",
    location: "Sports Field",
    member: "Max",
    initials: "MA",
    color: "bg-chart-5",
    category: "Sports",
  },
  {
    id: "5",
    title: "Family Dinner",
    date: "Apr 25",
    time: "7:00 PM",
    location: "Home",
    member: "Sarah",
    initials: "SA",
    color: "bg-primary",
    category: "Family",
  },
  {
    id: "6",
    title: "Birthday Party",
    date: "Apr 26",
    time: "3:00 PM",
    location: "Community Center",
    member: "Emma",
    initials: "EM",
    color: "bg-chart-3",
    category: "Social",
  },
];

export function UpcomingEvents() {
  return (
    <Card className="h-full flex flex-col border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold">Upcoming Events</CardTitle>
          <Badge variant="secondary" className="text-xs">
            {upcomingEvents.length} events
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-auto">
        <div className="flex flex-col gap-3">
          {upcomingEvents.map((event) => (
            <div
              key={event.id}
              className="group flex items-start gap-3 p-3 rounded-lg bg-accent/30 hover:bg-accent/50 transition-colors cursor-pointer"
            >
              <Avatar className="h-9 w-9 mt-0.5">
                <AvatarFallback
                  className={cn("text-primary-foreground text-xs", event.color)}
                >
                  {event.initials}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <h4 className="font-medium text-sm truncate">{event.title}</h4>
                  <Badge
                    variant="outline"
                    className="text-[10px] shrink-0 border-border/50"
                  >
                    {event.category}
                  </Badge>
                </div>
                <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3 w-3" />
                    <span>
                      {event.date} at {event.time}
                    </span>
                  </div>
                  {event.location && (
                    <div className="flex items-center gap-1.5">
                      <MapPin className="h-3 w-3" />
                      <span>{event.location}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5">
                    <User className="h-3 w-3" />
                    <span>{event.member}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
