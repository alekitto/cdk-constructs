import { DomainMappingOptions, IStage } from './stage';
import { Resource, aws_cloudwatch as cloudwatch } from 'aws-cdk-lib';
import { ApiMapping } from './api-mapping';
import { IApi } from './api';
import { IntegrationCache } from '../private/integration-cache';

/**
 * Base class representing an API
 * @internal
 */
export abstract class ApiBase extends Resource implements IApi {
    abstract readonly apiId: string;
    abstract readonly apiEndpoint: string;
    /**
     * @internal
     */
    protected _integrationCache: IntegrationCache = new IntegrationCache();

    public metric(metricName: string, props?: cloudwatch.MetricOptions): cloudwatch.Metric {
        return new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName,
            dimensionsMap: { ApiId: this.apiId },
            ...props,
        }).attachTo(this);
    }
}


/**
 * Base class representing a Stage
 * @internal
 */
export abstract class StageBase extends Resource implements IStage {
    public abstract readonly stageName: string;
    protected abstract readonly baseApi: IApi;

    /**
     * The created ApiMapping if domain mapping has been added
     * @internal
     */
    protected _apiMapping?: ApiMapping;

    /**
     * The URL to this stage.
     */
    abstract get url(): string;

    /**
     * @internal
     */
    protected _addDomainMapping(domainMapping: DomainMappingOptions) {
        if (this._apiMapping) {
            throw new Error('Only one ApiMapping allowed per Stage');
        }
        this._apiMapping = new ApiMapping(this, `${domainMapping.domainName}${domainMapping.mappingKey}`, {
            api: this.baseApi,
            domainName: domainMapping.domainName,
            stage: this,
            apiMappingKey: domainMapping.mappingKey,
        });
        // Ensure the dependency
        this.node.addDependency(domainMapping.domainName);
    }

    public metric(metricName: string, props?: cloudwatch.MetricOptions): cloudwatch.Metric {
        return this.baseApi.metric(metricName, props).with({
            dimensionsMap: { ApiId: this.baseApi.apiId, Stage: this.stageName },
        }).attachTo(this);
    }
}
