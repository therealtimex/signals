import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton, type TableSkeletonColumn } from "@/components/table-skeleton";

const contentColumns = [
  { label: "Content", lines: 2 },
  {
    label: "Status",
    className: "w-20 sm:w-32",
    skeletonClassName: "h-5 w-16 rounded-full",
  },
  {
    label: "Engagement",
    className: "hidden w-40 md:table-cell",
    skeletonClassName: "h-4 w-28",
  },
  {
    label: "Date",
    className: "hidden w-28 sm:table-cell",
    skeletonClassName: "h-4 w-20",
  },
  {
    label: "Actions",
    className: "w-16",
    skeletonClassName: "ml-auto size-8",
    srOnly: true,
  },
] satisfies readonly TableSkeletonColumn[];

export default function ContentLoading() {
  return (
    <div className="space-y-6">
      <PageHeader title="Content" description="Browse and manage content across platforms." actions={<Skeleton className="h-8 w-24" />} />
      <Skeleton className="h-9 w-full max-w-xl" />
      <TableSkeleton columns={contentColumns} />
    </div>
  );
}
