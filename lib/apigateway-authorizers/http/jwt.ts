import { apigateway } from '../..';

/**
 * Properties to initialize HttpJwtAuthorizer.
 */
export interface HttpJwtAuthorizerProps {

  /**
   * The name of the authorizer
   * @default - same value as `id` passed in the constructor
   */
  readonly authorizerName?: string;

  /**
   * The identity source for which authorization is requested.
   *
   * @default ['$request.header.Authorization']
   */
  readonly identitySource?: string[],

  /**
   * A list of the intended recipients of the JWT.
   * A valid JWT must provide an aud that matches at least one entry in this list.
   */
  readonly jwtAudience: string[]
}

/**
 * Authorize Http Api routes on whether the requester is registered as part of
 * an AWS Cognito user pool.
 */
export class HttpJwtAuthorizer implements apigateway.IHttpRouteAuthorizer {
    private authorizer?: apigateway.HttpAuthorizer;

    /**
     * Initialize a JWT authorizer to be bound with HTTP route.
     * @param id The id of the underlying construct
     * @param jwtIssuer The base domain of the identity provider that issues JWT
     * @param props Properties to configure the authorizer
     */
    // eslint-disable-next-line no-useless-constructor
    constructor(
      private readonly id: string,
      private readonly jwtIssuer: string,
      private readonly props: HttpJwtAuthorizerProps
    ) {
    }

    public bind(options: apigateway.HttpRouteAuthorizerBindOptions): apigateway.HttpRouteAuthorizerConfig {
        if (!this.authorizer) {
            this.authorizer = new apigateway.HttpAuthorizer(options.scope, this.id, {
                httpApi: options.route.httpApi,
                identitySource: this.props.identitySource ?? [ '$request.header.Authorization' ],
                type: apigateway.HttpAuthorizerType.JWT,
                authorizerName: this.props.authorizerName ?? this.id,
                jwtAudience: this.props.jwtAudience,
                jwtIssuer: this.jwtIssuer,
            });
        }

        return {
            authorizerId: this.authorizer.authorizerId,
            authorizationType: 'JWT',
        };
    }
}
