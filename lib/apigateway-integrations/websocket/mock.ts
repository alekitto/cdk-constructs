import { apigateway } from '../..';

/**
 * Mock WebSocket Integration
 */
export class WebSocketMockIntegration extends apigateway.WebSocketRouteIntegration {

    /**
   * @param id id of the underlying integration construct
   */
    // eslint-disable-next-line no-useless-constructor
    constructor(id: string) {
        super(id);
    }

    bind(_: apigateway.WebSocketRouteIntegrationBindOptions): apigateway.WebSocketRouteIntegrationConfig {
        return {
            type: apigateway.WebSocketIntegrationType.MOCK,
            uri: '',
        };
    }
}
