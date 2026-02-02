import { Context, type Effect } from "effect";
import type { ForgeError } from "./errors.js";
import type {
  Branch,
  CreateBranchInput,
  CreatePullRequestInput,
  ListPullRequestsOptions,
  PullRequest,
  Repository,
} from "./types.js";

/**
 * Git Forge service interface
 *
 * Provides a unified API for branch and pull request operations
 * across GitHub, GitLab, and Azure DevOps.
 */
export interface GitForgeService {
  // ─────────────────────────────────────────────────────────────────
  // Branch Operations
  // ─────────────────────────────────────────────────────────────────

  /**
   * Create a new branch from an existing ref
   */
  createBranch(
    repo: Repository,
    input: CreateBranchInput
  ): Effect.Effect<Branch, ForgeError>;

  /**
   * Get information about a specific branch
   */
  getBranch(repo: Repository, name: string): Effect.Effect<Branch, ForgeError>;

  /**
   * List all branches in a repository
   */
  listBranches(repo: Repository): Effect.Effect<Branch[], ForgeError>;

  // ─────────────────────────────────────────────────────────────────
  // Pull Request Operations
  // ─────────────────────────────────────────────────────────────────

  /**
   * Create a new pull request
   */
  createPullRequest(
    repo: Repository,
    input: CreatePullRequestInput
  ): Effect.Effect<PullRequest, ForgeError>;

  /**
   * Get a specific pull request by number
   */
  getPullRequest(
    repo: Repository,
    number: number
  ): Effect.Effect<PullRequest, ForgeError>;

  /**
   * List pull requests in a repository
   */
  listPullRequests(
    repo: Repository,
    options?: ListPullRequestsOptions
  ): Effect.Effect<PullRequest[], ForgeError>;
}

/**
 * Effect Context tag for GitForgeService
 */
export const GitForge = Context.GenericTag<GitForgeService>("GitForge");
