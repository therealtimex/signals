"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LucideIcon } from "lucide-react";

export interface StatCardItem {
  label: string;
  value: string;
  description?: string;
  icon?: LucideIcon;
}

interface StatCardsRowProps {
  items: StatCardItem[];
  className?: string;
}

export function StatCardsRow({ items, className }: StatCardsRowProps) {
  return (
    <div className={`grid gap-4 ${getGridCols(items.length)} ${className ?? ""}`}>
      {items.map((item) => (
        <Card key={item.label}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {item.label}
            </CardTitle>
            {item.icon && <item.icon className="h-4 w-4 text-muted-foreground" />}
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-display">{item.value}</div>
            {item.description && (
              <p className="text-xs text-muted-foreground mt-1">{item.description}</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function getGridCols(count: number): string {
  if (count <= 2) return "grid-cols-1 sm:grid-cols-2";
  if (count === 3) return "grid-cols-1 sm:grid-cols-3";
  if (count === 5) return "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5";
  return "grid-cols-2 sm:grid-cols-4";
}
