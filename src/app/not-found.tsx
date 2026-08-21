import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SignalsMascot } from "@/components/signals-mascot";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <SignalsMascot
        mood="surprised"
        size={112}
        decorative={false}
        title="Page not found"
      />
      <h1 className="text-heading-1 mt-6 mb-2">This page slipped the net</h1>
      <p className="text-muted-foreground max-w-md mb-6">
        We could not find what you were looking for. It may have been renamed,
        moved, or never existed at all.
      </p>
      <Button asChild>
        <Link href="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  );
}
