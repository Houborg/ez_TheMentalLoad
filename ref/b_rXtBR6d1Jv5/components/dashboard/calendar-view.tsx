"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

interface CalendarEvent {
  id: string;
  title: string;
  date: Date;
  color: string;
  member: string;
}

const sampleEvents: CalendarEvent[] = [
  {
    id: "1",
    title: "Team Meeting",
    date: new Date(2026, 3, 18),
    color: "bg-primary",
    member: "Sarah",
  },
  {
    id: "2",
    title: "Doctor Appointment",
    date: new Date(2026, 3, 20),
    color: "bg-chart-2",
    member: "Tom",
  },
  {
    id: "3",
    title: "Piano Lesson",
    date: new Date(2026, 3, 21),
    color: "bg-chart-3",
    member: "Emma",
  },
  {
    id: "4",
    title: "Soccer Practice",
    date: new Date(2026, 3, 22),
    color: "bg-chart-5",
    member: "Max",
  },
  {
    id: "5",
    title: "Family Dinner",
    date: new Date(2026, 3, 25),
    color: "bg-primary",
    member: "Sarah",
  },
  {
    id: "6",
    title: "Birthday Party",
    date: new Date(2026, 3, 26),
    color: "bg-chart-3",
    member: "Emma",
  },
  {
    id: "7",
    title: "Dentist",
    date: new Date(2026, 3, 28),
    color: "bg-chart-2",
    member: "Tom",
  },
  {
    id: "8",
    title: "School Play",
    date: new Date(2026, 3, 30),
    color: "bg-chart-5",
    member: "Max",
  },
];

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  const day = new Date(year, month, 1).getDay();
  return day === 0 ? 6 : day - 1;
}

export function CalendarView() {
  const [currentDate, setCurrentDate] = React.useState(new Date(2026, 3, 18));
  const [selectedDate, setSelectedDate] = React.useState<Date | null>(
    new Date(2026, 3, 18)
  );

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const daysInMonth = getDaysInMonth(year, month);
  const firstDayOfMonth = getFirstDayOfMonth(year, month);
  const today = new Date();

  const prevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const getEventsForDate = (date: Date) => {
    return sampleEvents.filter(
      (event) =>
        event.date.getDate() === date.getDate() &&
        event.date.getMonth() === date.getMonth() &&
        event.date.getFullYear() === date.getFullYear()
    );
  };

  const isToday = (day: number) => {
    return (
      day === today.getDate() &&
      month === today.getMonth() &&
      year === today.getFullYear()
    );
  };

  const isSelected = (day: number) => {
    return (
      selectedDate &&
      day === selectedDate.getDate() &&
      month === selectedDate.getMonth() &&
      year === selectedDate.getFullYear()
    );
  };

  const days: (number | null)[] = [];
  for (let i = 0; i < firstDayOfMonth; i++) {
    days.push(null);
  }
  for (let i = 1; i <= daysInMonth; i++) {
    days.push(i);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold tracking-tight">
          {MONTHS[month]} {year}
        </h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={prevMonth}
            className="h-8 w-8"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentDate(new Date())}
            className="h-8"
          >
            Today
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={nextMonth}
            className="h-8 w-8"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden flex-1">
        {DAYS.map((day) => (
          <div
            key={day}
            className="bg-card p-3 text-center text-sm font-medium text-muted-foreground"
          >
            {day}
          </div>
        ))}
        {days.map((day, index) => {
          const dateForDay = day ? new Date(year, month, day) : null;
          const events = dateForDay ? getEventsForDate(dateForDay) : [];

          return (
            <div
              key={index}
              className={cn(
                "bg-card p-2 min-h-[100px] transition-colors cursor-pointer hover:bg-accent/50",
                day === null && "bg-card/50",
                isSelected(day as number) && "bg-accent"
              )}
              onClick={() => day && setSelectedDate(new Date(year, month, day))}
            >
              {day && (
                <>
                  <div
                    className={cn(
                      "w-7 h-7 flex items-center justify-center text-sm rounded-full mb-1",
                      isToday(day) && "bg-primary text-primary-foreground",
                      !isToday(day) && "text-foreground"
                    )}
                  >
                    {day}
                  </div>
                  <div className="flex flex-col gap-1">
                    {events.slice(0, 2).map((event) => (
                      <div
                        key={event.id}
                        className={cn(
                          "text-xs px-1.5 py-0.5 rounded truncate text-primary-foreground",
                          event.color
                        )}
                      >
                        {event.title}
                      </div>
                    ))}
                    {events.length > 2 && (
                      <div className="text-xs text-muted-foreground px-1">
                        +{events.length - 2} more
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
