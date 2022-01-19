import { Names, Stack, aws_iam as iam, aws_lambda as lambda } from 'aws-cdk-lib';
import { apigateway } from '../..';

/**
 * Properties to initialize WebSocketTokenAuthorizer.
 */
export interface WebSocketLambdaAuthorizerProps {

  /**
   * The name of the authorizer
   * @default - same value as `id` passed in the constructor.
   */
  readonly authorizerName?: string;

  /**
   * The identity source for which authorization is requested.
   *
   * Request parameter match `'route.request.querystring|header.[a-zA-z0-9._-]+'`.
   * Staged variable match `'stageVariables.[a-zA-Z0-9._-]+'`.
   * Context parameter match `'context.[a-zA-Z0-9._-]+'`.
   *
   * @default ['route.request.header.Authorization']
   */
  readonly identitySource?: string[];
}

/**
 * Authorize WebSocket Api routes via a lambda function
 */
export class WebSocketLambdaAuthorizer implements apigateway.IWebSocketRouteAuthorizer {
    private authorizer?: apigateway.WebSocketAuthorizer;
    private webSocketApi?: apigateway.IWebSocketApi;

    // eslint-disable-next-line no-useless-constructor
    constructor(
        private readonly id: string,
        private readonly handler: lambda.IFunction,
        private readonly props: WebSocketLambdaAuthorizerProps = {}
    ) {
    }

    public bind(options: apigateway.WebSocketRouteAuthorizerBindOptions): apigateway.WebSocketRouteAuthorizerConfig {
        if (this.webSocketApi && (this.webSocketApi.apiId !== options.route.webSocketApi.apiId)) {
            throw new Error('Cannot attach the same authorizer to multiple Apis');
        }

        if (!this.authorizer) {
            this.webSocketApi = options.route.webSocketApi;
            this.authorizer = new apigateway.WebSocketAuthorizer(options.scope, this.id, {
                webSocketApi: options.route.webSocketApi,
                identitySource: this.props.identitySource ?? [
                    'route.request.header.Authorization',
                ],
                type: apigateway.WebSocketAuthorizerType.LAMBDA,
                authorizerName: this.props.authorizerName ?? this.id,
                authorizerUri: lambdaAuthorizerArn(this.handler),
            });

            this.handler.addPermission(`${Names.nodeUniqueId(this.authorizer.node)}-Permission`, {
                scope: options.scope,
                principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
                sourceArn: Stack.of(options.route).formatArn({
                    service: 'execute-api',
                    resource: options.route.webSocketApi.apiId,
                    resourceName: `authorizers/${this.authorizer.authorizerId}`,
                }),
            });
        }

        return {
            authorizerId: this.authorizer.authorizerId,
            authorizationType: 'CUSTOM',
        };
    }
}

/**
 * Constructs the authorizerURIArn.
 */
function lambdaAuthorizerArn(handler: lambda.IFunction) {
    return `arn:${Stack.of(handler).partition}:apigateway:${Stack.of(handler).region}:lambda:path/2015-03-31/functions/${handler.functionArn}/invocations`;
}
