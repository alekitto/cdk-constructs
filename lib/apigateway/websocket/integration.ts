import { Resource, aws_apigatewayv2 as apigatewayv2 } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { IIntegration } from '../common';
import { IWebSocketApi } from './api';
import { IWebSocketRoute } from './route';

/**
 * Represents an Integration for an WebSocket API.
 */
export interface IWebSocketIntegration extends IIntegration {
    /** The WebSocket API associated with this integration */
    readonly webSocketApi: IWebSocketApi;
}

/**
 * WebSocket Integration Types
 */
export enum WebSocketIntegrationType {
    /**
     * AWS Proxy Integration Type
     */
    AWS_PROXY = 'AWS_PROXY'
}

/**
 * The integration properties
 */
export interface WebSocketIntegrationProps {
    /**
     * The WebSocket API to which this integration should be bound.
     */
    readonly webSocketApi: IWebSocketApi;

    /**
     * Integration type
     */
    readonly integrationType: WebSocketIntegrationType;

    /**
     * Integration URI.
     */
    readonly integrationUri: string;
}

/**
 * The integration for an API route.
 * @resource AWS::ApiGatewayV2::Integration
 */
export class WebSocketIntegration extends Resource implements IWebSocketIntegration {
    public readonly integrationId: string;
    public readonly webSocketApi: IWebSocketApi;

    constructor(scope: Construct, id: string, props: WebSocketIntegrationProps) {
        super(scope, id);
        const integ = new apigatewayv2.CfnIntegration(this, 'Resource', {
            apiId: props.webSocketApi.apiId,
            integrationType: props.integrationType,
            integrationUri: props.integrationUri,
        });
        this.integrationId = integ.ref;
        this.webSocketApi = props.webSocketApi;
    }
}

/**
 * Options to the WebSocketRouteIntegration during its bind operation.
 */
export interface WebSocketRouteIntegrationBindOptions {
    /**
     * The route to which this is being bound.
     */
    readonly route: IWebSocketRoute;

    /**
     * The current scope in which the bind is occurring.
     * If the `WebSocketRouteIntegration` being bound creates additional constructs,
     * this will be used as their parent scope.
     */
    readonly scope: Construct;
}

/**
 * The interface that various route integration classes will inherit.
 */
export interface IWebSocketRouteIntegration {
    /**
     * Bind this integration to the route.
     */
    bind(options: WebSocketRouteIntegrationBindOptions): WebSocketRouteIntegrationConfig;
}

/**
 * Config returned back as a result of the bind.
 */
export interface WebSocketRouteIntegrationConfig {
    /**
     * Integration type.
     */
    readonly type: WebSocketIntegrationType;

    /**
     * Integration URI
     */
    readonly uri: string;
}
