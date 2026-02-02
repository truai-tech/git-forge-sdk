import "dotenv/config";
import { Effect } from "effect";
import { createGitForge, type Repository } from "../src/index.js";

// Configuration - set via environment variables or .env file
const PROVIDER = (process.env.GIT_PROVIDER ?? "github") as "github" | "gitlab" | "azure-devops";
const TOKEN = process.env.GIT_TOKEN;
const OWNER = process.env.GIT_OWNER ?? "octokit";
const REPO = process.env.GIT_REPO ?? "octokit.js";
const BASE_URL = process.env.GIT_BASE_URL;
const PROJECT = process.env.GIT_PROJECT; // Azure DevOps only

if (!TOKEN) {
  console.error("Error: GIT_TOKEN environment variable is required");
  console.error("\nCreate a .env file with:");
  console.error("  GIT_PROVIDER=github");
  console.error("  GIT_TOKEN=ghp_xxx");
  console.error("  GIT_OWNER=owner");
  console.error("  GIT_REPO=repo");
  process.exit(1);
}

// Create forge instance based on provider
const forge = createGitForge(
  PROVIDER === "github"
    ? { type: "github", token: TOKEN, ...(BASE_URL && { baseUrl: BASE_URL }) }
    : PROVIDER === "gitlab"
      ? { type: "gitlab", token: TOKEN, ...(BASE_URL && { baseUrl: BASE_URL }) }
      : { type: "azure-devops", token: TOKEN, orgUrl: BASE_URL ?? "" }
);

const repo: Repository = {
  provider: PROVIDER,
  owner: OWNER,
  repo: REPO,
  ...(PROJECT && { project: PROJECT }),
};

console.log(`\n=== git-forge demo: ${OWNER}/${REPO} (${PROVIDER}) ===\n`);

const program = Effect.gen(function* () {
  // List branches
  console.log("📌 Branches:");
  console.log("-".repeat(40));
  
  const branches = yield* forge.listBranches(repo);
  
  for (const branch of branches) {
    const flags = [
      branch.isDefault ? "default" : null,
      branch.protected ? "protected" : null,
    ].filter(Boolean).join(", ");
    
    console.log(`  ${branch.name} (${branch.sha.slice(0, 7)})${flags ? ` [${flags}]` : ""}`);
  }
  
  console.log(`\nTotal: ${branches.length} branches\n`);

  // List pull requests
  console.log("🔀 Pull Requests (open):");
  console.log("-".repeat(40));
  
  const prs = yield* forge.listPullRequests(repo, { state: "open" });
  
  if (prs.length === 0) {
    console.log("  No open pull requests");
  } else {
    for (const pr of prs) {
      const draft = pr.draft ? " [draft]" : "";
      console.log(`  #${pr.number} ${pr.title}${draft}`);
      console.log(`     ${pr.sourceBranch} → ${pr.targetBranch} | by ${pr.author}`);
    }
  }
  
  console.log(`\nTotal: ${prs.length} open PRs\n`);

  return { branches, prs };
});

Effect.runPromise(program).catch((error) => {
  console.error("\nError:", error);
  process.exit(1);
});
