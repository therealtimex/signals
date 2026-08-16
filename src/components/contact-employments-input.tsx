"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2 } from "lucide-react";
import { OrgPicker } from "@/components/org-picker";
import {
  draftFromContactEmployment,
  draftFromLegacyCompany,
  emptyDraftEmployment,
  type DraftContactEmployment,
} from "@/lib/contact-employment-draft";
import type { ContactEmploymentDTO } from "@/lib/db/queries/contact-dto";

type Row = DraftContactEmployment & { rowId: string };

interface ContactEmploymentsInputProps {
  defaultEmployments?: ContactEmploymentDTO[];
  defaultCompany?: string | null;
  defaultTitle?: string | null;
  defaultOrgId?: string;
  onChange: (employments: DraftContactEmployment[]) => void;
}

export function ContactEmploymentsInput({
  defaultEmployments = [],
  defaultCompany,
  defaultTitle,
  defaultOrgId,
  onChange,
}: ContactEmploymentsInputProps) {
  const initialRows =
    defaultEmployments.length > 0
      ? defaultEmployments.map((employment, index) => ({
          ...draftFromContactEmployment(employment),
          rowId: `employment-row-${index}`,
        }))
      : draftFromLegacyCompany(defaultCompany, defaultTitle).map((employment, index) => ({
          ...employment,
          orgId: defaultOrgId,
          rowId: `employment-row-${index}`,
        }));

  const nextRowId = useRef(initialRows.length);
  const [rows, setRows] = useState<Row[]>(initialRows);

  function sync(next: Row[]) {
    setRows(next);
    onChange(next.map(({ rowId: _rowId, ...employment }) => employment));
  }

  function updateRow(rowId: string, patch: Partial<DraftContactEmployment>) {
    sync(rows.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)));
  }

  function addRow() {
    const rowId = `employment-row-${nextRowId.current++}`;
    sync([...rows, { ...emptyDraftEmployment(), rowId }]);
  }

  function removeRow(rowId: string) {
    sync(rows.filter((row) => row.rowId !== rowId));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>Employment</Label>
        <Button type="button" size="sm" variant="outline" onClick={addRow}>
          <Plus className="mr-2 h-4 w-4" />
          Add Role
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Optional — add current or past roles.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((row, index) => (
            <div key={row.rowId} className="rounded-md border p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">Role {index + 1}</span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => removeRow(row.rowId)}
                  aria-label={`Remove role ${index + 1}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              <OrgPicker
                id={`${row.rowId}-org`}
                defaultOrgId={row.orgId}
                defaultOrgName={row.orgName ?? ""}
                onChange={(value) => {
                  updateRow(row.rowId, {
                    orgId: value.orgId || undefined,
                    orgName: value.company,
                  });
                }}
              />

              <div className="grid gap-2">
                <Label htmlFor={`${row.rowId}-title`}>Title</Label>
                <Input
                  id={`${row.rowId}-title`}
                  value={row.title ?? ""}
                  onChange={(e) => updateRow(row.rowId, { title: e.target.value })}
                  placeholder="Job title"
                />
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  id={`${row.rowId}-current`}
                  checked={Boolean(row.isCurrent)}
                  onCheckedChange={(checked) => updateRow(row.rowId, { isCurrent: checked })}
                />
                <Label htmlFor={`${row.rowId}-current`}>Current role</Label>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
