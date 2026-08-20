import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { WorkflowRunSubject } from "@/lib/workflows/workflow-run-subjects-shared";

export function WorkflowRunSubjectsPanel({
  subjects,
}: {
  subjects: WorkflowRunSubject[];
}) {
  if (subjects.length === 0) return null;

  const contacts = subjects.filter((subject) => subject.kind === "contact");
  const organizations = subjects.filter((subject) => subject.kind === "organization");

  return (
    <section id="run-subjects" className="space-y-3 scroll-mt-6">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">Subjects</h2>
        <Badge variant="secondary" className="text-[10px]">
          {subjects.length}
        </Badge>
      </div>

      <Card className="p-3 space-y-3">
        {contacts.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              Contacts
            </p>
            <div className="flex flex-wrap gap-2">
              {contacts.map((subject) => (
                <Link
                  key={subject.id}
                  href={subject.href}
                  className="inline-flex max-w-full items-center rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-xs text-primary hover:bg-muted hover:underline"
                  title={subject.label}
                >
                  <span className="truncate">{subject.label}</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {organizations.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              Organizations
            </p>
            <div className="flex flex-wrap gap-2">
              {organizations.map((subject) => (
                <Link
                  key={subject.id}
                  href={subject.href}
                  className="inline-flex max-w-full items-center rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-xs text-primary hover:bg-muted hover:underline"
                  title={subject.label}
                >
                  <span className="truncate">{subject.label}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </Card>
    </section>
  );
}
