export type WorkflowRunSubjectKind = "contact" | "organization";

export type WorkflowRunSubject = {
  kind: WorkflowRunSubjectKind;
  id: string;
  label: string;
  href: string;
};

export function workflowSubjectLookup(
  subjects: WorkflowRunSubject[],
): Record<string, WorkflowRunSubject> {
  return Object.fromEntries(subjects.map((subject) => [subject.id, subject]));
}
