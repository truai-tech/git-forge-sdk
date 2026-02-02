import { Layer } from "effect";
import type { ProviderConfig } from "./config.js";
import { GitForge, type GitForgeService } from "./GitForge.js";
import { createAzureDevOpsProvider } from "./providers/azure-devops.js";
import { createGitHubProvider } from "./providers/github.js";
import { createGitLabProvider } from "./providers/gitlab.js";

// ─────────────────────────────────────────────────────────────────────────────
// Re-exports
// ─────────────────────────────────────────────────────────────────────────────

export type {
  Provider,
  Repository,
  Branch,
  PullRequest,
  PullRequestState,
  CreateBranchInput,
  CreatePullRequestInput,
  ListPullRequestsOptions,
} from "./types.js";

export type {
  ProviderConfig,
  GitHubConfig,
  GitLabConfig,
  AzureDevOpsConfig,
} from "./config.js";

export {
  GitForgeError,
  AuthenticationError,
  NotFoundError,
  RateLimitError,
  ValidationError,
  type ForgeError,
} from "./errors.js";

export { GitForge, type GitForgeService } from "./GitForge.js";

// ─────────────────────────────────────────────────────────────────────────────
// Factory Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a GitForgeService instance for the specified provider
 *
 * @example
 * ```typescript
 * import { createGitForge } from "git-forge";
 *
 * const forge = createGitForge({
 *   type: "github",
 *   token: process.env.GITHUB_TOKEN!,
 * });
 *
 * const branch = await Effect.runPromise(
 *   forge.createBranch(
 *     { provider: "github", owner: "myorg", repo: "myrepo" },
 *     { name: "feature/new-thing", fromRef: "main" }
 *   )
 * );
 * ```
 */
export function createGitForge(config: ProviderConfig): GitForgeService {
  switch (config.type) {
    case "github":
      return createGitHubProvider(config);
    case "gitlab":
      return createGitLabProvider(config);
    case "azure-devops":
      return createAzureDevOpsProvider(config);
  }
}

/**
 * Create an Effect Layer providing GitForgeService
 *
 * @example
 * ```typescript
 * import { Effect } from "effect";
 * import { GitForge, GitForgeLayer } from "git-forge";
 *
 * const program = Effect.gen(function* () {
 *   const forge = yield* GitForge;
 *   return yield* forge.listBranches({
 *     provider: "github",
 *     owner: "myorg",
 *     repo: "myrepo",
 *   });
 * });
 *
 * const result = await Effect.runPromise(
 *   program.pipe(
 *     Effect.provide(GitForgeLayer({ type: "github", token: "..." }))
 *   )
 * );
 * ```
 */
export function GitForgeLayer(config: ProviderConfig) {
  return Layer.succeed(GitForge, createGitForge(config));
}
