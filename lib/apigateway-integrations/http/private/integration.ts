import { apigateway } from '../../..';
import { aws_ec2 as ec2 } from 'aws-cdk-lib';

/**
 * Options required to use an existing vpcLink or configure a new one
 *
 * @internal
 */
export interface VpcLinkConfigurationOptions {
  /**
   * The vpc link to be used for the private integration
   *
   * @default - a new VpcLink is created
   */
  readonly vpcLink?: apigateway.IVpcLink;

  /**
   * The vpc for which the VpcLink needs to be created
   *
   * @default undefined
   */
  readonly vpc?: ec2.IVpc;
}

/**
 * The HTTP Private integration resource for HTTP API
 *
 * @internal
 */
export abstract class HttpPrivateIntegration extends apigateway.HttpRouteIntegration {
    protected httpMethod = apigateway.HttpMethod.ANY;
    protected payloadFormatVersion = apigateway.PayloadFormatVersion.VERSION_1_0; // 1.0 is required and is the only supported format
    protected integrationType = apigateway.HttpIntegrationType.HTTP_PROXY;
    protected connectionType = apigateway.HttpConnectionType.VPC_LINK;

    /**
   * Adds a vpcLink to the API if not passed in the options
   *
   * @internal
   */
    protected _configureVpcLink(bindOptions: apigateway.HttpRouteIntegrationBindOptions, configOptions: VpcLinkConfigurationOptions): apigateway.IVpcLink {
        let vpcLink = configOptions.vpcLink;
        if (!vpcLink) {
            if (!configOptions.vpc) {
                throw new Error('One of vpcLink or vpc should be provided for private integration');
            }

            vpcLink = bindOptions.route.httpApi.addVpcLink({ vpc: configOptions.vpc });
        }

        return vpcLink;
    }

  public abstract bind(options: apigateway.HttpRouteIntegrationBindOptions): apigateway.HttpRouteIntegrationConfig;
}
