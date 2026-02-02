/**
 * GitHub provider configuration
 */
export interface GitHubConfig {
  type: "github";
  /** Personal Access Token or OAuth token */
  token: string;
  /** API base URL (defaults to "https://api.github.com") */
  baseUrl?: string;
}

/**
 * GitLab provider configuration
 */
export interface GitLabConfig {
  type: "gitlab";
  /** Personal Access Token or OAuth token */
  token: string;
  /** GitLab instance URL (defaults to "https://gitlab.com") */
  baseUrl?: string;
}

/**
 * Azure DevOps provider configuration
 */
export interface AzureDevOpsConfig {
  type: "azure-devops";
  /** Personal Access Token */
  token: string;
  /** Organization URL (e.g., "https://dev.azure.com/myorg") */
  orgUrl: string;
}

/**
 * Provider configuration union type
 */
export type ProviderConfig = GitHubConfig | GitLabConfig | AzureDevOpsConfig;
