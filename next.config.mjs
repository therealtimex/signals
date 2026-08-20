import { existsSync, lstatSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";

/**
 * Turbopack refuses a `node_modules` symlink that resolves outside the project
 * root ("Symlink node_modules is invalid, it points out of the filesystem
 * root") — which is exactly the layout of a linked git worktree sharing the
 * main checkout's dependencies. Widening the root to the deepest ancestor
 * shared by the worktree and the symlink target makes those builds work
 * without copying node_modules.
 *
 * This stays inert unless `node_modules` really is a symlink, so CI and release
 * builds (where `npm ci` writes a real directory) keep the default root and the
 * standalone output tracing that depends on it.
 */
function resolveTurbopackRoot() {
  const projectRoot = import.meta.dirname;
  const modules = resolve(projectRoot, "node_modules");

  if (!existsSync(modules) || !lstatSync(modules).isSymbolicLink()) {
    return undefined;
  }

  const target = realpathSync(modules);
  const projectParts = projectRoot.split(sep);
  const targetParts = target.split(sep);
  const shared = [];

  for (let i = 0; i < Math.min(projectParts.length, targetParts.length); i += 1) {
    if (projectParts[i] !== targetParts[i]) break;
    shared.push(projectParts[i]);
  }

  const root = shared.join(sep) || sep;
  return root === projectRoot ? undefined : root;
}

const turbopackRoot = resolveTurbopackRoot();

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3", "playwright", "playwright-core"],
  devIndicators: false,
  ...(turbopackRoot ? { turbopack: { root: turbopackRoot } } : {}),
};

export default nextConfig;
