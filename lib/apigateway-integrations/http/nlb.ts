import { aws_ec2 as ec2, aws_elasticloadbalancingv2 as elbv2 } from 'aws-cdk-lib';
import { HttpPrivateIntegration } from './private/integration';
import { HttpPrivateIntegrationOptions } from './base-types';
import { apigateway } from '../..';

/**
 * Properties to initialize `HttpNlbIntegration`.
 */
export type HttpNlbIntegrationProps = HttpPrivateIntegrationOptions

/**
 * The Network Load Balancer integration resource for HTTP API
 */
export class HttpNlbIntegration extends HttpPrivateIntegration {
    /**
   * @param id id of the underlying integration construct
   * @param listener the ELB network listener
   * @param props properties to configure the integration
   */
    constructor(
        id: string,
        private readonly listener: elbv2.INetworkListener,
        private readonly props: HttpNlbIntegrationProps = {}
    ) {
        super(id);
    }

    public bind(options: apigateway.HttpRouteIntegrationBindOptions): apigateway.HttpRouteIntegrationConfig {
        let vpc: ec2.IVpc | undefined = this.props.vpcLink?.vpc;
        if (!vpc && (this.listener instanceof elbv2.NetworkListener)) {
            vpc = this.listener.loadBalancer.vpc;
        }
        if (!vpc) {
            throw new Error('The vpcLink property must be specified when using an imported Network Listener.');
        }

        const vpcLink = this._configureVpcLink(options, {
            vpcLink: this.props.vpcLink,
            vpc,
        });

        return {
            method: this.props.method ?? this.httpMethod,
            payloadFormatVersion: this.payloadFormatVersion,
            type: this.integrationType,
            connectionType: this.connectionType,
            connectionId: vpcLink.vpcLinkId,
            uri: this.listener.listenerArn,
            secureServerName: this.props.secureServerName,
            parameterMapping: this.props.parameterMapping,
        };
    }
}
