import { Gitlab } from "@gitbeaker/rest";
import { Effect } from "effect";
import type { GitLabConfig } from "../config.js";
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
  CommitFileInput,
  CommitResult,
  CreateBranchInput,
  CreatePullRequestInput,
  ListPullRequestsOptions,
  PullRequest,
} from "../types.js";

const PROVIDER = "gitlab" as const;

/**
 * Map GitLab API errors to typed ForgeErrors
 */
function mapError(error: unknown, operation: string) {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    if (message.includes("401") || message.includes("unauthorized")) {
      return new AuthenticationError({
        provider: PROVIDER,
        message: error.message,
      });
    }

    if (message.includes("404") || message.includes("not found")) {
      return new NotFoundError({
        provider: PROVIDER,
        resource: "repository",
        identifier: "unknown",
      });
    }

    if (message.includes("422") || message.includes("invalid")) {
      return new ValidationError({
        provider: PROVIDER,
        message: error.message,
      });
    }

    if (message.includes("429") || message.includes("rate limit")) {
      return new RateLimitError({
        provider: PROVIDER,
      });
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
 * Map GitLab MR state to normalized state
 */
function mapMrState(state: string): "open" | "closed" | "merged" {
  if (state === "merged") return "merged";
  if (state === "opened") return "open";
  return "closed";
}

/**
 * Build GitLab project ID from owner and repo
 * GitLab uses "owner/repo" as project identifier
 */
function getProjectId(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}

/**
 * Create a GitLab provider implementation
 */
export function createGitLabProvider(config: GitLabConfig): GitForgeService {
  const gitlab = new Gitlab({
    token: config.token,
    host: config.baseUrl ?? "https://gitlab.com",
  });

  return {
    // ─────────────────────────────────────────────────────────────────
    // Branch Operations
    // ─────────────────────────────────────────────────────────────────

    createBranch: (repo, input: CreateBranchInput) =>
      Effect.tryPromise({
        try: async () => {
          const projectId = getProjectId(repo.owner, repo.repo);

          const branch = await gitlab.Branches.create(
            projectId,
            input.name,
            input.fromRef
          );

          // Get project to check default branch
          const project = await gitlab.Projects.show(projectId);

          return {
            name: branch.name,
            sha: branch.commit.id,
            isDefault: project.default_branch === branch.name,
            protected: branch.protected,
          } satisfies Branch;
        },
        catch: (e) => mapError(e, "createBranch"),
      }),

    getBranch: (repo, name: string) =>
      Effect.tryPromise({
        try: async () => {
          const projectId = getProjectId(repo.owner, repo.repo);

          const [branch, project] = await Promise.all([
            gitlab.Branches.show(projectId, name),
            gitlab.Projects.show(projectId),
          ]);

          return {
            name: branch.name,
            sha: branch.commit.id,
            isDefault: project.default_branch === branch.name,
            protected: branch.protected,
          } satisfies Branch;
        },
        catch: (e) => {
          if (
            e instanceof Error &&
            e.message.toLowerCase().includes("not found")
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

    listBranches: (repo) =>
      Effect.tryPromise({
        try: async () => {
          const projectId = getProjectId(repo.owner, repo.repo);

          const [branches, project] = await Promise.all([
            gitlab.Branches.all(projectId, { perPage: 100 }),
            gitlab.Projects.show(projectId),
          ]);

          return branches.map(
            (b) =>
              ({
                name: b.name,
                sha: b.commit.id,
                isDefault: project.default_branch === b.name,
                protected: b.protected,
              }) satisfies Branch
          );
        },
        catch: (e) => mapError(e, "listBranches"),
      }),

    // ─────────────────────────────────────────────────────────────────
    // File Operations
    // ─────────────────────────────────────────────────────────────────

    commitFile: (repo, input: CommitFileInput) =>
      Effect.tryPromise({
        try: async () => {
          const projectId = getProjectId(repo.owner, repo.repo);

          // Check if file exists
          let fileExists = false;
          try {
            await gitlab.RepositoryFiles.show(projectId, input.path, input.branch);
            fileExists = true;
          } catch {
            // File doesn't exist
          }

          // Create or update file
          let result;
          if (fileExists) {
            result = await gitlab.RepositoryFiles.edit(
              projectId,
              input.path,
              input.branch,
              input.content,
              input.message
            );
          } else {
            result = await gitlab.RepositoryFiles.create(
              projectId,
              input.path,
              input.branch,
              input.content,
              input.message
            );
          }

          // GitLab returns file_path in the response, we need to get the commit SHA
          // from a separate API call since file operations don't return it directly
          const branch = await gitlab.Branches.show(projectId, input.branch);

          return {
            sha: branch.commit.id,
            message: input.message,
          } satisfies CommitResult;
        },
        catch: (e) => mapError(e, "commitFile"),
      }),

    // ─────────────────────────────────────────────────────────────────
    // Merge Request Operations
    // ─────────────────────────────────────────────────────────────────

    createPullRequest: (repo, input: CreatePullRequestInput) =>
      Effect.tryPromise({
        try: async () => {
          const projectId = getProjectId(repo.owner, repo.repo);

          // GitLab marks MRs as draft when title starts with "Draft: "
          const title = input.draft ? `Draft: ${input.title}` : input.title;
          
          const mr = await gitlab.MergeRequests.create(
            projectId,
            input.sourceBranch,
            input.targetBranch,
            title,
            input.description !== undefined
              ? { description: input.description }
              : undefined
          );

          return {
            id: mr.id,
            number: mr.iid,
            title: mr.title,
            description: mr.description,
            state: mapMrState(mr.state),
            sourceBranch: mr.source_branch,
            targetBranch: mr.target_branch,
            author: mr.author?.username ?? "unknown",
            url: mr.web_url,
            draft: mr.draft ?? mr.work_in_progress ?? false,
            createdAt: new Date(mr.created_at),
            updatedAt: new Date(mr.updated_at),
          } satisfies PullRequest;
        },
        catch: (e) => mapError(e, "createPullRequest"),
      }),

    getPullRequest: (repo, number: number) =>
      Effect.tryPromise({
        try: async () => {
          const projectId = getProjectId(repo.owner, repo.repo);

          const mr = await gitlab.MergeRequests.show(projectId, number);

          return {
            id: mr.id,
            number: mr.iid,
            title: mr.title,
            description: mr.description,
            state: mapMrState(mr.state),
            sourceBranch: mr.source_branch,
            targetBranch: mr.target_branch,
            author: mr.author?.username ?? "unknown",
            url: mr.web_url,
            draft: mr.draft ?? mr.work_in_progress ?? false,
            createdAt: new Date(mr.created_at),
            updatedAt: new Date(mr.updated_at),
          } satisfies PullRequest;
        },
        catch: (e) => {
          if (
            e instanceof Error &&
            e.message.toLowerCase().includes("not found")
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

    listPullRequests: (repo, options?: ListPullRequestsOptions) =>
      Effect.tryPromise({
        try: async () => {
          const projectId = getProjectId(repo.owner, repo.repo);

          // GitLab uses "opened", "closed", "merged", or "locked"
          // For "all", we omit the state filter
          const state: "opened" | "closed" | "merged" | undefined =
            options?.state === "all"
              ? undefined
              : options?.state === "closed"
                ? "closed"
                : "opened";

          const mrs = await gitlab.MergeRequests.all({
            projectId,
            ...(state !== undefined && { state }),
            perPage: options?.limit ?? 30,
          });

          return mrs.map(
            (mr) =>
              ({
                id: mr.id,
                number: mr.iid,
                title: mr.title,
                description: mr.description,
                state: mapMrState(mr.state),
                sourceBranch: mr.source_branch,
                targetBranch: mr.target_branch,
                author: mr.author?.username ?? "unknown",
                url: mr.web_url,
                draft: mr.draft ?? mr.work_in_progress ?? false,
                createdAt: new Date(mr.created_at),
                updatedAt: new Date(mr.updated_at),
              }) satisfies PullRequest
          );
        },
        catch: (e) => mapError(e, "listPullRequests"),
      }),
  };
}
