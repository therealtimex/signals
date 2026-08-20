import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export interface TableSkeletonColumn {
  label: string;
  className?: string;
  skeletonClassName?: string;
  lines?: 1 | 2;
  srOnly?: boolean;
}

interface TableSkeletonProps {
  columns: readonly TableSkeletonColumn[];
  rows?: number;
}

export function TableSkeleton({ columns, rows = 8 }: TableSkeletonProps) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column.label} className={column.className}>
                {column.srOnly ? <span className="sr-only">{column.label}</span> : column.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rows }, (_, index) => (
            <TableRow key={index}>
              {columns.map((column) => (
                <TableCell key={column.label} className={column.className}>
                  {column.lines === 2 ? (
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-2/5" />
                      <Skeleton className="h-3 w-4/5" />
                    </div>
                  ) : (
                    <Skeleton className={column.skeletonClassName ?? "h-4 w-20"} />
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
