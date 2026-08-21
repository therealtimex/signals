"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { SignalsMascot } from "@/components/signals-mascot";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <SignalsMascot
        mood="scared"
        size={112}
        decorative={false}
        title="Something went wrong"
      />
      <h1 className="text-heading-1 mt-6 mb-2">Something went wrong</h1>
      <p className="text-muted-foreground max-w-md mb-6">
        Signals hit an unexpected error. Trying again often clears it.
      </p>
      {error.digest && (
        <p className="text-muted-foreground/70 text-xs mb-6 font-mono">
          Reference: {error.digest}
        </p>
      )}
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
