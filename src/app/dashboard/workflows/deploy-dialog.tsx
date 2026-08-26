"use client";

import { useEffect, useReducer } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Rocket, Save, X } from "lucide-react";
import { SnowballSeedScoutFields } from "@/app/dashboard/workflows/snowball-seed-scout-fields";
import {
  buildSnowballSeedScoutDeployConfig,
  isSnowballSeedScoutTemplateConfig,
  readSnowballSeedScoutConfig,
} from "@/lib/workflows/snowball-seed-scout";

interface Template {
  id: string;
  name: string;
  description: string | null;
  config: string;
}

interface DeployDialogProps {
  template: Template;
  open: boolean;
  onClose: () => void;
}

type DialogState = {
  loading: boolean;
  saving: boolean;
  deploying: boolean;
  error: string | null;
  deployedAt: string | null;
  workspaceSlug: string | null;
  scout: ReturnType<typeof readSnowballSeedScoutConfig>;
};

type DialogAction =
  | { type: "SET_SCOUT"; scout: DialogState["scout"] }
  | { type: "SET_LOADING"; loading: boolean }
  | { type: "SET_SAVING"; saving: boolean }
  | { type: "SET_DEPLOYING"; deploying: boolean }
  | { type: "SET_ERROR"; error: string | null }
  | {
      type: "DEPLOY_SUCCESS";
      deployedAt: string;
      workspaceSlug: string;
    };

function parseTemplateConfig(config: string): Record<string, unknown> {
  try {
    return JSON.parse(config || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

function initState(template: Template): DialogState {
  const config = parseTemplateConfig(template.config);
  return {
    loading: false,
    saving: false,
    deploying: false,
    error: null,
    deployedAt: null,
    workspaceSlug: null,
    scout: readSnowballSeedScoutConfig(config),
  };
}

function reducer(state: DialogState, action: DialogAction): DialogState {
  switch (action.type) {
    case "SET_SCOUT":
      return { ...state, scout: action.scout };
    case "SET_LOADING":
      return { ...state, loading: action.loading };
    case "SET_SAVING":
      return { ...state, saving: action.saving };
    case "SET_DEPLOYING":
      return { ...state, deploying: action.deploying };
    case "SET_ERROR":
      return { ...state, error: action.error };
    case "DEPLOY_SUCCESS":
      return {
        ...state,
        deployedAt: action.deployedAt,
        workspaceSlug: action.workspaceSlug,
        error: null,
      };
    default:
      return state;
  }
}

function DeployDialogContent({
  template,
  onClose,
}: {
  template: Template;
  onClose: () => void;
}) {
  const [state, dispatch] = useReducer(reducer, template, initState);
  const isDeployed = Boolean(state.deployedAt);

  useEffect(() => {
    dispatch({ type: "SET_LOADING", loading: true });
    fetch("/api/snowball-seed-scout/deployment")
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Deployment lookup failed (${res.status})`);
        }
        return res.json();
      })
      .then((payload) => {
        const deployment = payload.deployment as Record<string, unknown> | null;
        if (deployment) {
          dispatch({
            type: "SET_SCOUT",
            scout: readSnowballSeedScoutConfig(deployment),
          });
          if (typeof deployment.deployedAt === "string") {
            dispatch({
              type: "DEPLOY_SUCCESS",
              deployedAt: deployment.deployedAt,
              workspaceSlug: "signals",
            });
          }
        }
      })
      .catch(() => {
        dispatch({ type: "SET_ERROR", error: "Failed to load deployment status" });
      })
      .finally(() => dispatch({ type: "SET_LOADING", loading: false }));
  }, [template.id]);

  const deployConfig = buildSnowballSeedScoutDeployConfig(state.scout);

  const handleDeploy = async (action: "deploy" | "undeploy") => {
    dispatch({ type: "SET_DEPLOYING", deploying: true });
    dispatch({ type: "SET_ERROR", error: null });
    try {
      const res = await fetch(`/api/workflows/templates/${template.id}/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, config: deployConfig }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || "Deploy failed");
      }
      if (action === "deploy" && payload.deployment?.deployedAt) {
        dispatch({
          type: "DEPLOY_SUCCESS",
          deployedAt: payload.deployment.deployedAt,
          workspaceSlug: payload.workspaceSlug ?? "signals",
        });
      } else if (action === "undeploy") {
        dispatch({ type: "DEPLOY_SUCCESS", deployedAt: "", workspaceSlug: "" });
        dispatch({
          type: "SET_SCOUT",
          scout: { ...state.scout, enabled: false },
        });
      }
    } catch (error) {
      dispatch({
        type: "SET_ERROR",
        error: error instanceof Error ? error.message : "Deploy failed",
      });
    } finally {
      dispatch({ type: "SET_DEPLOYING", deploying: false });
    }
  };

  const handleSave = async () => {
    if (!isDeployed) return;
    dispatch({ type: "SET_SAVING", saving: true });
    dispatch({ type: "SET_ERROR", error: null });
    try {
      const res = await fetch("/api/snowball-seed-scout/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: template.id,
          config: deployConfig,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || "Save failed");
      }
      if (payload.deployment) {
        dispatch({
          type: "SET_SCOUT",
          scout: readSnowballSeedScoutConfig(payload.deployment),
        });
      }
    } catch (error) {
      dispatch({
        type: "SET_ERROR",
        error: error instanceof Error ? error.message : "Save failed",
      });
    } finally {
      dispatch({ type: "SET_SAVING", saving: false });
    }
  };

  return (
    <>
      <DialogHeader className="px-6 pt-6 pb-2">
        <DialogTitle className="flex items-center gap-2">
          <Rocket className="h-4 w-4" />
          {template.name}
        </DialogTitle>
        <DialogDescription>
          Deploy adds a heartbeat shell task to your RealTimeX workspace. The scout harvests post
          URLs deterministically and queues Network Snowball runs on the calendar.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 px-6 py-2 max-h-[65vh] overflow-y-auto">
        {state.loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading deployment…
          </div>
        ) : (
          <SnowballSeedScoutFields
            value={state.scout}
            onChange={(scout) => dispatch({ type: "SET_SCOUT", scout })}
            disabled={state.deploying || state.saving}
          />
        )}

        {isDeployed && (
          <p className="text-xs text-muted-foreground">
            Deployed
            {state.deployedAt ? ` ${new Date(state.deployedAt).toLocaleString()}` : ""}
            {state.workspaceSlug ? ` · workspace ${state.workspaceSlug}` : ""}
          </p>
        )}

        {state.error && (
          <p className="text-sm text-destructive">{state.error}</p>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t px-6 py-4">
        <DialogClose asChild>
          <Button variant="ghost" size="sm">
            <X className="mr-1.5 h-3.5 w-3.5" />
            Close
          </Button>
        </DialogClose>
        <div className="flex gap-2">
          {isDeployed && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleDeploy("undeploy")}
                disabled={state.deploying || state.saving || state.loading}
              >
                Undeploy
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleSave()}
                disabled={state.deploying || state.saving || state.loading}
              >
                {state.saving ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="mr-1.5 h-3.5 w-3.5" />
                )}
                Save settings
              </Button>
            </>
          )}
          <Button
            size="sm"
            onClick={() => void handleDeploy("deploy")}
            disabled={state.deploying || state.saving || state.loading}
          >
            {state.deploying ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Rocket className="mr-1.5 h-3.5 w-3.5" />
            )}
            {isDeployed ? "Redeploy" : "Deploy"}
          </Button>
        </div>
      </div>
    </>
  );
}

export function DeployDialog({ template, open, onClose }: DeployDialogProps) {
  const config = parseTemplateConfig(template.config);
  if (!isSnowballSeedScoutTemplateConfig(config)) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg p-0 gap-0">
        <DeployDialogContent template={template} onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}

export function isSnowballSeedScoutTemplate(template: Template): boolean {
  return isSnowballSeedScoutTemplateConfig(parseTemplateConfig(template.config));
}
