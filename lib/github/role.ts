import { Annotations, aws_iam as iam } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { GitHubActionsIdentityProvider } from './provider';
import { Mutable } from '../util/mutable';

const githubRepoRegex = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}\/.+$/i;

/**
 * GitHub related configuration that forms the trust policy for this IAM Role.
 */
interface GitHubConfiguration {
    /**
     * Reference to GitHub OpenID Connect Provider configured in AWS IAM.
     *
     * Either pass a construct defined by `new GitHubActionsIdentityProvider`
     * or a retrieved reference from `GitHubActionsIdentityProvider.fromAccount`.
     * There can be only one (per AWS Account).
     */
    readonly provider: GitHubActionsIdentityProvider;

    /**
     * Repository name (slug) without the owner.
     *
     * @example 'octo-org/octo-repo'
     */
    readonly repo: string;

    /**
     * Subject condition filter, appended after `repo:${owner}/${repo}:` string in IAM Role trust relationship.
     *
     * @default
     * '*'
     *
     * You may use this value to only allow GitHub to assume the role on specific branches, tags, environments, pull requests etc.
     * @example
     *   'ref:refs/tags/v*'
     *   'ref:refs/heads/demo-branch'
     *   'pull_request'
     *   'environment:Production'
     *
     * @see https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect#examples
     */
    readonly filter?: string;
}

/**
 * Props that define the IAM Role that can be assumed by GitHub Actions workflow
 * via GitHub OpenID Connect Identity Provider.
 *
 * Besides, `GitHubConfiguration`, you may pass in any `iam.RoleProps` except `assumedBy`
 * which will be defined by this construct (CDK will fail if you do).
 *
 * @example
 * {
 *   provider: GitHubActionsIdentityProvider.fromAccount(scope, "GitHubProvider"),
 *   owner: 'octo-org',
 *   repo: 'octo-repo',
 *   filter: 'ref:refs/tags/v*',
 *   roleName: 'MyDeployRole',
 * }
 */
interface GitHubActionsRoleProps extends GitHubConfiguration, Omit<iam.RoleProps, 'assumedBy'> {}

/**
 * Define an IAM Role that can be assumed by GitHub Actions workflow
 * via GitHub OpenID Connect Identity Provider.
 *
 * Besides `GitHubConfiguration`, you may pass in any `iam.RoleProps` except `assumedBy`
 * which will be defined by this construct (CDK will fail if you do).
 *
 * @example
 * const uploadRole = new GitHubActionsRole(scope, "UploadRole", {
 *   provider: GitHubActionsIdentityProvider.fromAccount(scope, "GitHubProvider"),
 *   owner: 'octo-org',
 *   repo: 'octo-repo',
 *   filter: 'ref:refs/tags/v*',
 *   roleName: 'MyUploadRole',
 * });
 *
 * myBucket.grantWrite(uploadRole);
 */
export class GitHubActionsRole extends iam.Role {
    /**
     * Define an IAM Role that can be assumed by GitHub Actions workflow
     * via GitHub OpenID Connect Identity Provider.
     *
     * Besides `GitHubConfiguration`, you may pass in any `iam.RoleProps` except `assumedBy`
     * which will be defined by this construct (CDK will fail if you do).
     *
     * @example
     * const uploadRole = new GitHubActionsRole(scope, "UploadRole", {
     *   provider: GitHubActionsIdentityProvider.fromAccount(scope, "GitHubProvider"),
     *   owner: 'octo-org',
     *   repo: 'octo-repo',
     *   filter: 'ref:refs/tags/v*',
     *   roleName: 'MyUploadRole',
     * });
     *
     * myBucket.grantWrite(uploadRole);
     */
    constructor(scope: Construct, id: string, props: GitHubActionsRoleProps) {
        const { provider, repo } = props;

        // Perform validations
        GitHubActionsRole.validateRepo(scope, repo);

        // Prepare values
        const subject = GitHubActionsRole.formatSubject(props);
        const roleProps = GitHubActionsRole.extractRoleProps(props);

        // The actual IAM Role creation
        super(scope, id, {
            ...roleProps,
            assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
                StringLike: {
                    // Only allow specified subjects to assume this role
                    [`${GitHubActionsIdentityProvider.issuer}:sub`]: subject,
                },
                StringEquals: {
                    // Audience is always sts.amazonaws.com with AWS official GitHub Action
                    // https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services#adding-the-identity-provider-to-aws
                    [`${GitHubActionsIdentityProvider.issuer}:aud`]: 'sts.amazonaws.com',
                },
            }),
        });
    }

    /**
     * Extracts props given for the created IAM Role Construct.
     * @param props for the GitHubActionsRole
     * @returns for the IAM Role
     */
    private static extractRoleProps(props: GitHubActionsRoleProps): iam.RoleProps {
        const extractProps: Mutable<Partial<GitHubActionsRoleProps>> = { ...props };
        delete extractProps.provider;
        delete extractProps.repo;
        delete extractProps.filter;

        return extractProps as unknown as iam.RoleProps;
    }

    /** Validates the GitHub repository name. */
    private static validateRepo(scope: Construct, repo: string): void {
        if (! githubRepoRegex.test(repo)) {
            Annotations.of(scope).addError(`Invalid GitHub Repository "${repo}". Owner must only contain alphanumeric characters or hyphens, cannot have multiple consecutive hyphens, cannot begin or end with a hyphen and maximum length is 39 characters and repository name cannot be empty.`);
        }
    }

    /** Formats the `sub` value used in trust policy. */
    private static formatSubject({ repo, filter = '*' }: GitHubConfiguration): string {
        return `repo:${repo}:${filter}`;
    }
}

