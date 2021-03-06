import * as crypto from 'crypto';
import { Construct } from 'constructs';
import { HttpRouteIntegrationConfig } from '../http';
import { IIntegration } from '../common';
import { Stack } from 'aws-cdk-lib';
import { WebSocketRouteIntegrationConfig } from '../websocket';

type IntegrationConfig = HttpRouteIntegrationConfig | WebSocketRouteIntegrationConfig;

export class IntegrationCache {
    private integrations: Record<string, IIntegration> = {};

    getIntegration(scope: Construct, config: IntegrationConfig) {
        const configHash = this.integrationConfigHash(scope, config);
        const integration = this.integrations[configHash];
        return { configHash, integration };
    }

    saveIntegration(scope: Construct, config: IntegrationConfig, integration: IIntegration) {
        const configHash = this.integrationConfigHash(scope, config);
        this.integrations[configHash] = integration;
    }

    private integrationConfigHash(scope: Construct, config: IntegrationConfig): string {
        const stringifiedConfig = JSON.stringify(Stack.of(scope).resolve(config));
        const configHash = crypto.createHash('md5').update(stringifiedConfig).digest('hex');
        return configHash;
    }
}
