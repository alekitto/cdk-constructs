import { Stack, aws_iam as iam, aws_lambda as lambda } from 'aws-cdk-lib';
import { apigateway } from '../..';

/**
 * Lambda WebSocket Integration
 */
export class WebSocketLambdaIntegration extends apigateway.WebSocketRouteIntegration {
    private readonly _id: string;

    /**
   * @param id id of the underlying integration construct
   * @param handler the Lambda function handler
   * @param props properties to configure the integration
   */
    constructor(id: string, private readonly handler: lambda.IFunction) {
        super(id);
        this._id = id;
    }

    bind(options: apigateway.WebSocketRouteIntegrationBindOptions): apigateway.WebSocketRouteIntegrationConfig {
        const route = options.route;
        this.handler.addPermission(`${this._id}-Permission`, {
            scope: options.scope,
            principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
            sourceArn: Stack.of(route).formatArn({
                service: 'execute-api',
                resource: route.webSocketApi.apiId,
                resourceName: `*/*${route.routeKey}`,
            }),
        });

        const integrationUri = Stack.of(route).formatArn({
            service: 'apigateway',
            account: 'lambda',
            resource: 'path/2015-03-31/functions',
            resourceName: `${this.handler.functionArn}/invocations`,
        });

        return {
            type: apigateway.WebSocketIntegrationType.AWS_PROXY,
            uri: integrationUri,
        };
    }
}
