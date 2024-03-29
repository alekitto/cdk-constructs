import {Stack, aws_iam as iam, aws_lambda as lambda, Duration} from 'aws-cdk-lib';
import { apigateway } from '../..';

/**
 * Lambda Proxy integration properties
 */
export interface HttpLambdaIntegrationProps {
  /**
   * Version of the payload sent to the lambda handler.
   * @see https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html
   * @default PayloadFormatVersion.VERSION_2_0
   */
  readonly payloadFormatVersion?: apigateway.PayloadFormatVersion;

  /**
   * Specifies how to transform HTTP requests before sending them to the backend
   * @see https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-parameter-mapping.html
   * @default undefined requests are sent to the backend unmodified
   */
  readonly parameterMapping?: apigateway.ParameterMapping;

  /**
   * Specifies the timeout of the HTTP request
   * @default undefined
   */
  readonly timeout?: Duration;
}

/**
 * The Lambda Proxy integration resource for HTTP API
 */
export class HttpLambdaIntegration extends apigateway.HttpRouteIntegration {

    private readonly _id: string;

    /**
   * @param id id of the underlying integration construct
   * @param handler the Lambda handler to integrate with
   * @param props properties to configure the integration
   */
    constructor(
        id: string,
    private readonly handler: lambda.IFunction,
    private readonly props: HttpLambdaIntegrationProps = {}) {

        super(id);
        this._id = id;
    }

    public bind(options: apigateway.HttpRouteIntegrationBindOptions): apigateway.HttpRouteIntegrationConfig {
        const route = options.route;
        this.handler.addPermission(`${this._id}-Permission`, {
            scope: options.scope,
            principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
            sourceArn: Stack.of(route).formatArn({
                service: 'execute-api',
                resource: route.httpApi.apiId,
                resourceName: `*/*${route.path ?? ''}`, // Empty string in the case of the catch-all route $default
            }),
        });

        return {
            type: apigateway.HttpIntegrationType.AWS_PROXY,
            uri: this.handler.functionArn,
            payloadFormatVersion: this.props.payloadFormatVersion ?? apigateway.PayloadFormatVersion.VERSION_2_0,
            parameterMapping: this.props.parameterMapping,
            timeout: this.props.timeout,
        };
    }
}
