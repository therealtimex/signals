"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  agentProfileMissingFields,
  type AgentProfile,
} from "@/lib/arpp/missing-fields";

export function AgentProfileView({ profile }: { profile: AgentProfile }) {
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(profile, null, 2);
  const conformance = profile.signals.conformance;
  const missing = agentProfileMissingFields(profile);

  async function copyJson() {
    await navigator.clipboard.writeText(json);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }

  return (
    <Card>
      <CardContent className="py-4">
        <details>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-medium">
            <span>Agent view</span>
            <Badge variant="outline">{conformance}</Badge>
          </summary>
          <div className="mt-4 space-y-4">
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="text-sm font-medium">Missing for higher conformance</p>
              {missing.length > 0 ? (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {missing.map((field) => (
                    <li key={field}>{field}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">
                  Highest conformance level reached.
                </p>
              )}
            </div>
            <div className="flex justify-end">
              <Button type="button" variant="outline" size="sm" onClick={() => void copyJson()}>
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied ? "Copied" : "Copy JSON"}
              </Button>
            </div>
            <pre className="max-h-96 overflow-auto rounded-md bg-muted p-4 text-xs">
              <code>{json}</code>
            </pre>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
