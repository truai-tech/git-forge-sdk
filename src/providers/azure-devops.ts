import * as azdev from "azure-devops-node-api";
import type { GitPullRequest } from "azure-devops-node-api/interfaces/GitInterfaces.js";
import { Effect } from "effect";
import type { AzureDevOpsConfig } from "../config.js";
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
  Repository,
} from "../types.js";

const PROVIDER = "azure-devops" as const;

/**
 * Map Azure DevOps API errors to typed ForgeErrors
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

    if (message.includes("400") || message.includes("invalid")) {
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
 * Map Azure DevOps PR status to normalized state
 * Azure uses: 1 = active, 2 = abandoned, 3 = completed
 */
function mapPrState(status: number | undefined): "open" | "closed" | "merged" {
  switch (status) {
    case 1:
      return "open";
    case 3:
      return "merged";
    default:
      return "closed";
  }
}

/**
 * Extract branch name from full ref path
 * e.g., "refs/heads/main" -> "main"
 */
function extractBranchName(ref: string | undefined): string {
  if (!ref) return "unknown";
  return ref.replace(/^refs\/heads\//, "");
}

/**
 * Map Azure PR to normalized PullRequest
 */
function mapPullRequest(pr: GitPullRequest, baseUrl: string): PullRequest {
  const repoName = pr.repository?.name ?? "unknown";
  const project = pr.repository?.project?.name ?? "unknown";
  const prUrl = `${baseUrl}/${project}/_git/${repoName}/pullrequest/${pr.pullRequestId}`;

  return {
    id: pr.pullRequestId ?? 0,
    number: pr.pullRequestId ?? 0,
    title: pr.title ?? "",
    description: pr.description ?? null,
    state: mapPrState(pr.status),
    sourceBranch: extractBranchName(pr.sourceRefName),
    targetBranch: extractBranchName(pr.targetRefName),
    author: pr.createdBy?.displayName ?? pr.createdBy?.uniqueName ?? "unknown",
    url: prUrl,
    draft: pr.isDraft ?? false,
    createdAt: pr.creationDate ?? new Date(),
    updatedAt: pr.creationDate ?? new Date(), // Azure doesn't have updatedAt easily
  };
}

/**
 * Ensure project is provided for Azure DevOps
 */
function getProject(repo: Repository): string {
  if (!repo.project) {
    throw new ValidationError({
      provider: PROVIDER,
      message:
        "Azure DevOps requires a project name. Set repo.project to the Azure DevOps project name.",
      field: "project",
    });
  }
  return repo.project;
}

/**
 * Create an Azure DevOps provider implementation
 */
export function createAzureDevOpsProvider(
  config: AzureDevOpsConfig
): GitForgeService {
  // Create connection - will be used lazily
  const authHandler = azdev.getPersonalAccessTokenHandler(config.token);
  const connection = new azdev.WebApi(config.orgUrl, authHandler);

  return {
    // ─────────────────────────────────────────────────────────────────
    // Branch Operations
    // ─────────────────────────────────────────────────────────────────

    createBranch: (repo: Repository, input: CreateBranchInput) =>
      Effect.tryPromise({
        try: async () => {
          const project = getProject(repo);
          const gitApi = await connection.getGitApi();

          // Get the source ref to find the SHA
          let sha: string;

          if (/^[0-9a-f]{40}$/i.test(input.fromRef)) {
            sha = input.fromRef;
          } else {
            // Get SHA from branch name
            const refs = await gitApi.getRefs(
              repo.repo,
              project,
              `heads/${input.fromRef}`
            );
            const sourceRef = refs[0];
            if (!sourceRef?.objectId) {
              throw new NotFoundError({
                provider: PROVIDER,
                resource: "branch",
                identifier: input.fromRef,
              });
            }
            sha = sourceRef.objectId;
          }

          // Create branch using ref update
          const refUpdate = {
            name: `refs/heads/${input.name}`,
            oldObjectId: "0000000000000000000000000000000000000000",
            newObjectId: sha,
          };

          const results = await gitApi.updateRefs([refUpdate], repo.repo, project);
          const result = results[0];

          if (!result?.success) {
            throw new ValidationError({
              provider: PROVIDER,
              message: `Failed to create branch: ${result?.customMessage ?? "unknown error"}`,
            });
          }

          // Get default branch
          const repoInfo = await gitApi.getRepository(repo.repo, project);
          const defaultBranch = extractBranchName(repoInfo.defaultBranch);

          return {
            name: input.name,
            sha,
            isDefault: defaultBranch === input.name,
            protected: false,
          } satisfies Branch;
        },
        catch: (e) => {
          if (e instanceof ValidationError || e instanceof NotFoundError) {
            return e;
          }
          return mapError(e, "createBranch");
        },
      }),

    getBranch: (repo: Repository, name: string) =>
      Effect.tryPromise({
        try: async () => {
          const project = getProject(repo);
          const gitApi = await connection.getGitApi();

          const refs = await gitApi.getRefs(repo.repo, project, `heads/${name}`);
          const ref = refs[0];

          if (!ref) {
            throw new NotFoundError({
              provider: PROVIDER,
              resource: "branch",
              identifier: name,
            });
          }

          // Get default branch
          const repoInfo = await gitApi.getRepository(repo.repo, project);
          const defaultBranch = extractBranchName(repoInfo.defaultBranch);

          return {
            name,
            sha: ref.objectId ?? "",
            isDefault: defaultBranch === name,
            protected: ref.isLocked ?? false,
          } satisfies Branch;
        },
        catch: (e) => {
          if (e instanceof NotFoundError) return e;
          return mapError(e, "getBranch");
        },
      }),

    listBranches: (repo: Repository) =>
      Effect.tryPromise({
        try: async () => {
          const project = getProject(repo);
          const gitApi = await connection.getGitApi();

          const [refs, repoInfo] = await Promise.all([
            gitApi.getRefs(repo.repo, project, "heads/"),
            gitApi.getRepository(repo.repo, project),
          ]);

          const defaultBranch = extractBranchName(repoInfo.defaultBranch);

          return refs.map(
            (ref) =>
              ({
                name: extractBranchName(ref.name),
                sha: ref.objectId ?? "",
                isDefault: extractBranchName(ref.name) === defaultBranch,
                protected: ref.isLocked ?? false,
              }) satisfies Branch
          );
        },
        catch: (e) => mapError(e, "listBranches"),
      }),

    // ─────────────────────────────────────────────────────────────────
    // File Operations
    // ─────────────────────────────────────────────────────────────────

    commitFile: (repo: Repository, input: CommitFileInput) => {
      const getLatestRef = (gitApi: any, repoName: string, project: string, branch: string) =>
        Effect.tryPromise({
          try: async () => {
            const refs = await gitApi.getRefs(repoName, project, `heads/${branch}`);
            const ref = refs[0];
            if (!ref?.objectId) {
              throw new NotFoundError({
                provider: PROVIDER,
                resource: "branch",
                identifier: branch,
              });
            }
            return ref.objectId as string;
          },
          catch: (e) => {
            if (e instanceof NotFoundError) return e;
            return mapError(e, "commitFile");
          },
        });

      const pushFile = (gitApi: any, repoName: string, project: string, branch: string, oldObjectId: string, changeType: number) =>
        Effect.tryPromise({
          try: () =>
            gitApi.createPush(
              {
                refUpdates: [{ name: `refs/heads/${branch}`, oldObjectId }],
                commits: [{
                  comment: input.message,
                  changes: [{
                    changeType,
                    item: { path: `/${input.path}` },
                    newContent: { content: input.content, contentType: 0 },
                  }],
                }],
              },
              repoName,
              project
            ),
          catch: (e) => mapError(e, "commitFile"),
        });

      return Effect.gen(function* () {
        const project = getProject(repo);
        const gitApi = yield* Effect.tryPromise({
          try: () => connection.getGitApi(),
          catch: (e) => mapError(e, "commitFile"),
        });

        const objectId = yield* getLatestRef(gitApi, repo.repo, project, input.branch);

        // Azure DevOps requires the correct changeType (1=add, 2=edit)
        // unlike GitHub/GitLab which auto-detect. Try add first, fall back to edit.
        const push = yield* pushFile(gitApi, repo.repo, project, input.branch, objectId, 1).pipe(
          Effect.catchAll(() => pushFile(gitApi, repo.repo, project, input.branch, objectId, 2))
        );

        return {
          sha: (push as any).commits?.[0]?.commitId ?? "",
          message: input.message,
        } satisfies CommitResult;
      });
    },

    // ─────────────────────────────────────────────────────────────────
    // Pull Request Operations
    // ─────────────────────────────────────────────────────────────────

    createPullRequest: (repo: Repository, input: CreatePullRequestInput) =>
      Effect.tryPromise({
        try: async () => {
          const project = getProject(repo);
          const gitApi = await connection.getGitApi();

          const pr = await gitApi.createPullRequest(
            {
              title: input.title,
              ...(input.description !== undefined && { description: input.description }),
              sourceRefName: `refs/heads/${input.sourceBranch}`,
              targetRefName: `refs/heads/${input.targetBranch}`,
              isDraft: input.draft ?? false,
            },
            repo.repo,
            project
          );

          return mapPullRequest(pr, config.orgUrl);
        },
        catch: (e) => mapError(e, "createPullRequest"),
      }),

    getPullRequest: (repo: Repository, number: number) =>
      Effect.tryPromise({
        try: async () => {
          const project = getProject(repo);
          const gitApi = await connection.getGitApi();

          const pr = await gitApi.getPullRequest(repo.repo, number, project);

          if (!pr) {
            throw new NotFoundError({
              provider: PROVIDER,
              resource: "pull-request",
              identifier: String(number),
            });
          }

          return mapPullRequest(pr, config.orgUrl);
        },
        catch: (e) => {
          if (e instanceof NotFoundError) return e;
          return mapError(e, "getPullRequest");
        },
      }),

    listPullRequests: (repo: Repository, options?: ListPullRequestsOptions) =>
      Effect.tryPromise({
        try: async () => {
          const project = getProject(repo);
          const gitApi = await connection.getGitApi();

          // Azure DevOps PR status: 1 = active, 2 = abandoned, 3 = completed, 4 = all
          let status: number;
          if (options?.state === "all") {
            status = 4;
          } else if (options?.state === "closed") {
            // "closed" in our API means both abandoned and completed
            status = 4; // Fetch all and filter
          } else {
            status = 1; // active = open
          }

          const searchCriteria = {
            repositoryId: repo.repo,
            status,
          };

          let prs = await gitApi.getPullRequests(
            repo.repo,
            searchCriteria,
            project,
            undefined,
            undefined,
            options?.limit ?? 30
          );

          // Filter if needed for "closed" state
          if (options?.state === "closed") {
            prs = prs.filter((pr) => pr.status === 2 || pr.status === 3);
          }

          return prs.map((pr) => mapPullRequest(pr, config.orgUrl));
        },
        catch: (e) => mapError(e, "listPullRequests"),
      }),
  };
}
