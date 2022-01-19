import { apigateway } from '../..';

/**
 * Authorize HTTP API Routes with IAM
 */
export class HttpIamAuthorizer implements apigateway.IHttpRouteAuthorizer {
    public bind(_: apigateway.HttpRouteAuthorizerBindOptions): apigateway.HttpRouteAuthorizerConfig {
        return {
            authorizationType: apigateway.HttpAuthorizerType.IAM,
        };
    }
}
