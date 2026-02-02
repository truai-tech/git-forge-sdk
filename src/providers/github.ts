import { Octokit } from "@octokit/rest";
import { Effect } from "effect";
import type { GitHubConfig } from "../config.js";
import {
  AuthenticationError,
  GitForgeError,
  NotFoundError,
  RateLimitError,
  ValidationError,
} from "../errors.js";
import type { GitForgeService } from "../GitForge.js";
import type {
  Branch,
  CreateBranchInput,
  CreatePullRequestInput,
  ListPullRequestsOptions,
  PullRequest,
  Repository,
} from "../types.js";

const PROVIDER = "github" as const;

/**
 * Map GitHub API errors to typed ForgeErrors
 */
function mapError(error: unknown, operation: string) {
  if (error instanceof Error && "status" in error) {
    const status = (error as { status: number }).status;

    if (status === 401 || status === 403) {
      return new AuthenticationError({
        provider: PROVIDER,
        message: error.message,
      });
    }

    if (status === 404) {
      return new NotFoundError({
        provider: PROVIDER,
        resource: "repository",
        identifier: "unknown",
      });
    }

    if (status === 422) {
      return new ValidationError({
        provider: PROVIDER,
        message: error.message,
      });
    }

    if (status === 429) {
      const retryAfterHeader = "headers" in error 
        ? (error as { headers?: { "retry-after"?: string } }).headers?.["retry-after"]
        : undefined;
      const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;
      return retryAfter !== undefined
        ? new RateLimitError({ provider: PROVIDER, retryAfter })
        : new RateLimitError({ provider: PROVIDER });
    }
  }

  return new GitForgeError({
    provider: PROVIDER,
    operation,
    message: error instanceof Error ? error.message : String(error),
    cause: error,
  });
}

/**
 * Map GitHub PR state to normalized state
 */
function mapPrState(
  state: string,
  merged: boolean
): "open" | "closed" | "merged" {
  if (merged) return "merged";
  if (state === "open") return "open";
  return "closed";
}

/**
 * Create a GitHub provider implementation
 */
export function createGitHubProvider(config: GitHubConfig): GitForgeService {
  const octokit = new Octokit({
    auth: config.token,
    baseUrl: config.baseUrl ?? "https://api.github.com",
  });

  return {
    // ─────────────────────────────────────────────────────────────────
    // Branch Operations
    // ─────────────────────────────────────────────────────────────────

    createBranch: (repo: Repository, input: CreateBranchInput) =>
      Effect.tryPromise({
        try: async () => {
          // Get the SHA of the source ref
          let sha: string;

          // Check if fromRef looks like a SHA (40 hex chars)
          if (/^[0-9a-f]{40}$/i.test(input.fromRef)) {
            sha = input.fromRef;
          } else {
            // It's a branch name, resolve it
            const { data: ref } = await octokit.git.getRef({
              owner: repo.owner,
              repo: repo.repo,
              ref: `heads/${input.fromRef}`,
            });
            sha = ref.object.sha;
          }

          // Create the new branch
          await octokit.git.createRef({
            owner: repo.owner,
            repo: repo.repo,
            ref: `refs/heads/${input.name}`,
            sha,
          });

          // Get default branch to check if this is it (unlikely for new branch)
          const { data: repoData } = await octokit.repos.get({
            owner: repo.owner,
            repo: repo.repo,
          });

          return {
            name: input.name,
            sha,
            isDefault: repoData.default_branch === input.name,
            protected: false, // New branches are not protected
          } satisfies Branch;
        },
        catch: (e) => mapError(e, "createBranch"),
      }),

    getBranch: (repo: Repository, name: string) =>
      Effect.tryPromise({
        try: async () => {
          const [branchRes, repoRes] = await Promise.all([
            octokit.repos.getBranch({
              owner: repo.owner,
              repo: repo.repo,
              branch: name,
            }),
            octokit.repos.get({
              owner: repo.owner,
              repo: repo.repo,
            }),
          ]);

          return {
            name: branchRes.data.name,
            sha: branchRes.data.commit.sha,
            isDefault: repoRes.data.default_branch === name,
            protected: branchRes.data.protected,
          } satisfies Branch;
        },
        catch: (e) => {
          if (
            e instanceof Error &&
            "status" in e &&
            (e as { status: number }).status === 404
          ) {
            return new NotFoundError({
              provider: PROVIDER,
              resource: "branch",
              identifier: name,
            });
          }
          return mapError(e, "getBranch");
        },
      }),

    listBranches: (repo: Repository) =>
      Effect.tryPromise({
        try: async () => {
          const [branchesRes, repoRes] = await Promise.all([
            octokit.repos.listBranches({
              owner: repo.owner,
              repo: repo.repo,
              per_page: 100,
            }),
            octokit.repos.get({
              owner: repo.owner,
              repo: repo.repo,
            }),
          ]);

          return branchesRes.data.map(
            (b) =>
              ({
                name: b.name,
                sha: b.commit.sha,
                isDefault: repoRes.data.default_branch === b.name,
                protected: b.protected,
              }) satisfies Branch
          );
        },
        catch: (e) => mapError(e, "listBranches"),
      }),

    // ─────────────────────────────────────────────────────────────────
    // Pull Request Operations
    // ─────────────────────────────────────────────────────────────────

    createPullRequest: (repo: Repository, input: CreatePullRequestInput) =>
      Effect.tryPromise({
        try: async () => {
          const { data } = await octokit.pulls.create({
            owner: repo.owner,
            repo: repo.repo,
            title: input.title,
            ...(input.description !== undefined && { body: input.description }),
            head: input.sourceBranch,
            base: input.targetBranch,
            draft: input.draft ?? false,
          });

          return {
            id: data.id,
            number: data.number,
            title: data.title,
            description: data.body,
            state: mapPrState(data.state, data.merged ?? false),
            sourceBranch: data.head.ref,
            targetBranch: data.base.ref,
            author: data.user?.login ?? "unknown",
            url: data.html_url,
            draft: data.draft ?? false,
            createdAt: new Date(data.created_at),
            updatedAt: new Date(data.updated_at),
          } satisfies PullRequest;
        },
        catch: (e) => mapError(e, "createPullRequest"),
      }),

    getPullRequest: (repo: Repository, number: number) =>
      Effect.tryPromise({
        try: async () => {
          const { data } = await octokit.pulls.get({
            owner: repo.owner,
            repo: repo.repo,
            pull_number: number,
          });

          return {
            id: data.id,
            number: data.number,
            title: data.title,
            description: data.body,
            state: mapPrState(data.state, data.merged ?? false),
            sourceBranch: data.head.ref,
            targetBranch: data.base.ref,
            author: data.user?.login ?? "unknown",
            url: data.html_url,
            draft: data.draft ?? false,
            createdAt: new Date(data.created_at),
            updatedAt: new Date(data.updated_at),
          } satisfies PullRequest;
        },
        catch: (e) => {
          if (
            e instanceof Error &&
            "status" in e &&
            (e as { status: number }).status === 404
          ) {
            return new NotFoundError({
              provider: PROVIDER,
              resource: "pull-request",
              identifier: String(number),
            });
          }
          return mapError(e, "getPullRequest");
        },
      }),

    listPullRequests: (repo: Repository, options?: ListPullRequestsOptions) =>
      Effect.tryPromise({
        try: async () => {
          const state =
            options?.state === "all"
              ? "all"
              : options?.state === "closed"
                ? "closed"
                : "open";

          const { data } = await octokit.pulls.list({
            owner: repo.owner,
            repo: repo.repo,
            state,
            per_page: options?.limit ?? 30,
          });

          return data.map(
            (pr) =>
              ({
                id: pr.id,
                number: pr.number,
                title: pr.title,
                description: pr.body,
                state: mapPrState(pr.state, pr.merged_at !== null),
                sourceBranch: pr.head.ref,
                targetBranch: pr.base.ref,
                author: pr.user?.login ?? "unknown",
                url: pr.html_url,
                draft: pr.draft ?? false,
                createdAt: new Date(pr.created_at),
                updatedAt: new Date(pr.updated_at),
              }) satisfies PullRequest
          );
        },
        catch: (e) => mapError(e, "listPullRequests"),
      }),
  };
}
