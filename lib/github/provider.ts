import { Stack, aws_iam as iam } from 'aws-cdk-lib';
import { Construct } from 'constructs';

/**
 * GitHub Actions as OpenID Connect Identity Provider for AWS IAM.
 * There can be only one (per AWS Account).
 *
 * Use `fromAccount` to retrieve a reference to existing GitHub OIDC provider.
 *
 * @see https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services
 */
export class GitHubActionsIdentityProvider extends iam.OpenIdConnectProvider {
    public static readonly issuer: string = 'token.actions.githubusercontent.com';
    public static readonly thumbprints: string[] = [
        'a031c46782e6e6c662c2c87c76da9aa62ccabd8e',
        '6938fd4d98bab03faadb97b34396831e3780aea1',
    ];

    /**
     * Define a new GitHub OpenID Connect Identity PRovider for AWS IAM.
     * There can be only one (per AWS Account).
     *
     * @param scope CDK Stack or Construct to which the provider is assigned to
     * @param id CDK Construct ID given to the construct
     *
     * @example new GitHubActionsIdentityProvider(scope, "GitHubProvider");
     */
    constructor(scope: Construct, id: string) {
        super(scope, id, {
            url: `https://${GitHubActionsIdentityProvider.issuer}`,
            thumbprints: GitHubActionsIdentityProvider.thumbprints,
            clientIds: [ 'sts.amazonaws.com' ],
        });
    }

    /**
     * Retrieve a reference to existing GitHub OIDC provider in your AWS account.
     * An AWS account can only have single GitHub OIDC provider configured into it,
     * so internally the reference is made by constructing the ARN from AWS
     * Account ID & GitHub issuer URL.
     *
     * @param scope CDK Stack or Construct to which the provider is assigned to
     * @param id CDK Construct ID given to the construct
     * @returns a CDK Construct representing the GitHub OIDC provider
     *
     * @example GitHubActionsIdentityProvider.fromAccount(scope, "GitHubProvider");
     */
    public static fromAccount(scope: Construct, id: string): iam.IOpenIdConnectProvider {
        const accountId = Stack.of(scope).account;
        const providerArn = `arn:aws:iam::${accountId}:oidc-provider/${GitHubActionsIdentityProvider.issuer}`;

        return iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(scope, id, providerArn);
    }
}
