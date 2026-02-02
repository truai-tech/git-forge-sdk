/**
 * Supported git hosting providers
 */
export type Provider = "github" | "gitlab" | "azure-devops";

/**
 * Repository identifier with provider-specific details
 */
export interface Repository {
  /** The git provider type */
  provider: Provider;
  /** Owner/organization/group name */
  owner: string;
  /** Repository name */
  repo: string;
  /** Azure DevOps project name (required for azure-devops provider) */
  project?: string;
}

/**
 * Git branch information
 */
export interface Branch {
  /** Branch name (without refs/heads/ prefix) */
  name: string;
  /** Commit SHA the branch points to */
  sha: string;
  /** Whether this is the repository's default branch */
  isDefault: boolean;
  /** Whether the branch is protected */
  protected: boolean;
}

/**
 * Pull request / merge request state
 */
export type PullRequestState = "open" | "closed" | "merged";

/**
 * Pull request information (normalized across providers)
 */
export interface PullRequest {
  /** Provider's internal ID */
  id: number;
  /** PR number for display (e.g., #123) */
  number: number;
  /** PR title */
  title: string;
  /** PR description/body (may be null) */
  description: string | null;
  /** Current state */
  state: PullRequestState;
  /** Source branch name */
  sourceBranch: string;
  /** Target/base branch name */
  targetBranch: string;
  /** Author username */
  author: string;
  /** Web URL to view the PR */
  url: string;
  /** Whether this is a draft PR */
  draft: boolean;
  /** Creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * Input for creating a new branch
 */
export interface CreateBranchInput {
  /** Name for the new branch */
  name: string;
  /** Source branch name or commit SHA to branch from */
  fromRef: string;
}

/**
 * Input for creating a new pull request
 */
export interface CreatePullRequestInput {
  /** PR title */
  title: string;
  /** PR description/body */
  description?: string;
  /** Source branch containing changes */
  sourceBranch: string;
  /** Target branch to merge into */
  targetBranch: string;
  /** Create as draft PR (if supported by provider) */
  draft?: boolean;
}

/**
 * Options for listing pull requests
 */
export interface ListPullRequestsOptions {
  /** Filter by state (defaults to "open") */
  state?: "open" | "closed" | "all";
  /** Maximum number of results to return */
  limit?: number;
}
