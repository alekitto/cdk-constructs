import { Stack, aws_cognito as cognito } from 'aws-cdk-lib';
import { apigateway } from '../..';

/**
 * Properties to initialize HttpUserPoolAuthorizer.
 */
export interface HttpUserPoolAuthorizerProps {
  /**
   * The user pool clients that should be used to authorize requests with the user pool.
   * @default - a new client will be created for the given user pool
   */
  readonly userPoolClients?: cognito.IUserPoolClient[];

  /**
   * The AWS region in which the user pool is present
   * @default - same region as the Route the authorizer is attached to.
   */
  readonly userPoolRegion?: string;

  /**
   * Friendly name of the authorizer
   * @default - same value as `id` passed in the constructor
   */
  readonly authorizerName?: string;

  /**
   * The identity source for which authorization is requested.
   *
   * @default ['$request.header.Authorization']
   */
  readonly identitySource?: string[];
}

/**
 * Authorize Http Api routes on whether the requester is registered as part of
 * an AWS Cognito user pool.
 */
export class HttpUserPoolAuthorizer implements apigateway.IHttpRouteAuthorizer {
    private authorizer?: apigateway.HttpAuthorizer;

    /**
   * Initialize a Cognito user pool authorizer to be bound with HTTP route.
   * @param id The id of the underlying construct
   * @param pool The user pool to use for authorization
   * @param props Properties to configure the authorizer
   */
    // eslint-disable-next-line no-useless-constructor
    constructor(
        private readonly id: string,
        private readonly pool: cognito.IUserPool,
        private readonly props: HttpUserPoolAuthorizerProps = {}
    ) {
    }

    public bind(options: apigateway.HttpRouteAuthorizerBindOptions): apigateway.HttpRouteAuthorizerConfig {
        if (!this.authorizer) {
            const region = this.props.userPoolRegion ?? Stack.of(options.scope).region;
            const clients = this.props.userPoolClients ?? [ this.pool.addClient('UserPoolAuthorizerClient') ];

            this.authorizer = new apigateway.HttpAuthorizer(options.scope, this.id, {
                httpApi: options.route.httpApi,
                identitySource: this.props.identitySource ?? [ '$request.header.Authorization' ],
                type: apigateway.HttpAuthorizerType.JWT,
                authorizerName: this.props.authorizerName ?? this.id,
                jwtAudience: clients.map((c) => c.userPoolClientId),
                jwtIssuer: `https://cognito-idp.${region}.amazonaws.com/${this.pool.userPoolId}`,
            });
        }

        return {
            authorizerId: this.authorizer.authorizerId,
            authorizationType: 'JWT',
        };
    }
}
