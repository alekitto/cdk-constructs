import { apigateway } from '../..';

/**
 * Properties to initialize a new `HttpProxyIntegration`.
 */
export interface HttpUrlIntegrationProps {
  /**
   * The HTTP method that must be used to invoke the underlying HTTP proxy.
   * @default HttpMethod.ANY
   */
  readonly method?: apigateway.HttpMethod;

  /**
   * Specifies how to transform HTTP requests before sending them to the backend
   * @see https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-parameter-mapping.html
   * @default undefined requests are sent to the backend unmodified
   */
  readonly parameterMapping?: apigateway.ParameterMapping;
}

/**
 * The HTTP Proxy integration resource for HTTP API
 */
export class HttpUrlIntegration extends apigateway.HttpRouteIntegration {
    /**
   * @param id id of the underlying integration construct
   * @param url the URL to proxy to
   * @param props properties to configure the integration
   */
    constructor(id: string, private readonly url: string, private readonly props: HttpUrlIntegrationProps = {}) {
        super(id);
    }

    public bind(_: apigateway.HttpRouteIntegrationBindOptions): apigateway.HttpRouteIntegrationConfig {
        return {
            method: this.props.method ?? apigateway.HttpMethod.ANY,
            payloadFormatVersion: apigateway.PayloadFormatVersion.VERSION_1_0, // 1.0 is required and is the only supported format
            type: apigateway.HttpIntegrationType.HTTP_PROXY,
            uri: this.url,
            parameterMapping: this.props.parameterMapping,
        };
    }
}
