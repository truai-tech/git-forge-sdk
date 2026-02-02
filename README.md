# git-forge

A unified TypeScript SDK for managing branches and pull requests across GitHub, GitLab, and Azure DevOps.

Built with [Effect](https://effect.website/) for typed errors, composability, and reliability.

## Installation

```bash
pnpm add git-forge
# or
npm install git-forge
```

## Quick Start

```typescript
import { createGitForge } from "git-forge";
import { Effect } from "effect";

// Create a forge instance
const forge = createGitForge({
  type: "github",
  token: process.env.GITHUB_TOKEN!,
});

// Define the repository
const repo = {
  provider: "github" as const,
  owner: "myorg",
  repo: "myrepo",
};

// Create a branch
const branch = await Effect.runPromise(
  forge.createBranch(repo, {
    name: "feature/my-feature",
    fromRef: "main",
  })
);

// Create a pull request
const pr = await Effect.runPromise(
  forge.createPullRequest(repo, {
    title: "Add new feature",
    description: "This PR adds...",
    sourceBranch: "feature/my-feature",
    targetBranch: "main",
  })
);

console.log(`Created PR #${pr.number}: ${pr.url}`);
```

## Providers

### GitHub

```typescript
import { createGitForge } from "git-forge";

const forge = createGitForge({
  type: "github",
  token: "ghp_xxxxxxxxxxxx",
  // Optional: for GitHub Enterprise
  baseUrl: "https://github.mycompany.com/api/v3",
});
```

**Required PAT scopes:** `repo` (Full control of private repositories)

### GitLab

```typescript
import { createGitForge } from "git-forge";

const forge = createGitForge({
  type: "gitlab",
  token: "glpat-xxxxxxxxxxxx",
  // Optional: for self-hosted GitLab
  baseUrl: "https://gitlab.mycompany.com",
});
```

**Required PAT scopes:** `api` or `write_repository`

### Azure DevOps

```typescript
import { createGitForge } from "git-forge";

const forge = createGitForge({
  type: "azure-devops",
  token: "xxxxxxxxxxxxxxxxxxxxxxxxx",
  orgUrl: "https://dev.azure.com/myorg",
});

// Note: Azure DevOps requires a project name
const repo = {
  provider: "azure-devops" as const,
  owner: "myorg",
  repo: "myrepo",
  project: "MyProject", // Required!
};
```

**Required PAT scopes:** Code (Read & Write), Pull Request Threads (Read & Write)

## API Reference

### Branch Operations

```typescript
// Create a branch
forge.createBranch(repo, {
  name: "feature/new-branch",
  fromRef: "main", // branch name or commit SHA
});

// Get branch info
forge.getBranch(repo, "main");

// List all branches
forge.listBranches(repo);
```

### Pull Request Operations

```typescript
// Create a PR
forge.createPullRequest(repo, {
  title: "My PR",
  description: "Description here",
  sourceBranch: "feature/branch",
  targetBranch: "main",
  draft: false,
});

// Get a specific PR
forge.getPullRequest(repo, 123);

// List PRs
forge.listPullRequests(repo, {
  state: "open", // "open" | "closed" | "all"
  limit: 30,
});
```

## Using with Effect

The library is built with Effect, providing typed errors and composability:

```typescript
import { Effect, pipe } from "effect";
import {
  createGitForge,
  GitForge,
  GitForgeLayer,
  NotFoundError,
} from "git-forge";

// Using the Layer for dependency injection
const program = Effect.gen(function* () {
  const forge = yield* GitForge;

  const branches = yield* forge.listBranches({
    provider: "github",
    owner: "myorg",
    repo: "myrepo",
  });

  return branches;
});

// Run with the layer
await Effect.runPromise(
  program.pipe(
    Effect.provide(
      GitForgeLayer({
        type: "github",
        token: process.env.GITHUB_TOKEN!,
      })
    )
  )
);
```

### Error Handling

```typescript
import { Effect } from "effect";
import {
  createGitForge,
  NotFoundError,
  AuthenticationError,
  RateLimitError,
} from "git-forge";

const forge = createGitForge({ type: "github", token: "..." });

const result = await Effect.runPromise(
  forge.getBranch(repo, "nonexistent").pipe(
    Effect.catchTags({
      NotFoundError: (e) =>
        Effect.succeed({ error: `Branch ${e.identifier} not found` }),
      AuthenticationError: (e) =>
        Effect.succeed({ error: "Invalid token" }),
      RateLimitError: (e) =>
        Effect.succeed({ error: `Rate limited, retry after ${e.retryAfter}s` }),
    })
  )
);
```

## Error Types

| Error | Description |
|-------|-------------|
| `GitForgeError` | Generic error with operation context |
| `AuthenticationError` | Invalid/expired token or insufficient scopes |
| `NotFoundError` | Repository, branch, or PR not found |
| `RateLimitError` | API rate limit exceeded |
| `ValidationError` | Invalid input (e.g., branch already exists) |

## License

MIT
