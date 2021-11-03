import {
    aws_ecs as ecs,
    aws_elasticloadbalancingv2 as elb,
    CfnOutput,
    Duration,
} from 'aws-cdk-lib';
import { ServiceExtension, ServiceBuild } from './extension-interfaces';
import { Service } from '../service';
import { Construct } from 'constructs';

interface NetworkLoadBalancerProps {
    /**
     * The listener descriptors
     */
    readonly listeners: (elb.BaseNetworkListenerProps & {
        proxyProtocolV2?: boolean;
        healthCheck?: elb.HealthCheck;
    })[];

    /**
     * (experimental) Indicates whether cross-zone load balancing is enabled.
     *
     * @default false
     * @experimental
     */
    readonly crossZoneEnabled?: boolean;

    /**
     * (experimental) Indicates whether deletion protection is enabled.
     *
     * @default false
     * @experimental
     */
    readonly deletionProtection?: boolean;
}

/**
 * This extension add a public facing load balancer for sending traffic
 * to one or more replicas of the application container
 */
export class NetworkLoadBalancerExtension extends ServiceExtension {
    private _loadBalancer!: elb.INetworkLoadBalancer;
    private listeners: elb.INetworkListener[] = [];

    constructor(private props: NetworkLoadBalancerProps) {
        super('network-load-balancer');

        if (props.listeners.length === 0) {
            throw new Error("Network load balancer must have at least one listener");
        }
    }

    get loadBalancer(): elb.INetworkLoadBalancer {
        return this._loadBalancer;
    }

    // Before the service is created go ahead and create the load balancer itself.
    public prehook(service: Service, scope: Construct) {
        this.parentService = service;

        this._loadBalancer = new elb.NetworkLoadBalancer(scope, `${this.parentService.id}-load-balancer`, {
            vpc: this.parentService.vpc,
            internetFacing: true,
            crossZoneEnabled: this.props.crossZoneEnabled,
            deletionProtection: this.props.deletionProtection,
        });

        this.listeners = this.props.listeners.map((listener, i) =>
            this._loadBalancer.addListener(`${this.parentService.id}-listener-${i}`, listener)
        );

        // Automatically create an output
        new CfnOutput(scope, `${this.parentService.id}-load-balancer-dns-output`, {
            value: this._loadBalancer.loadBalancerDnsName,
        });
    }

    // Minor service configuration tweaks to work better with a load balancer
    public modifyServiceProps(props: ServiceBuild): ServiceBuild {
        return {
            ...props,

            // Give the task a little bit of grace time to start passing
            // healthchecks. Without this it is possible for a slow starting task
            // to cause the ALB to consider the task unhealthy, causing ECS to stop
            // the task before it actually has a chance to finish starting up
            healthCheckGracePeriod: Duration.minutes(1),
        } as ServiceBuild;
    }

    // After the service is created add the service to the load balancer's listener
    public useService(service: ecs.Ec2Service | ecs.FargateService) {
        const containerName = this.parentService
            .serviceDescription
            .get('service-container')
            .container!
            .containerName;

        this.listeners.forEach((listener, i) => {
            let protocol = this.props.listeners[i].protocol ?? elb.Protocol.TCP;
            if (protocol !== elb.Protocol.TCP && protocol !== elb.Protocol.UDP) {
                throw new Error('Invalid protocol: must be TCP or UDP')
            }

            const target = service.loadBalancerTarget({
                containerName,
                containerPort: this.props.listeners[i].port,
                protocol: (this.props.listeners[i].protocol as string).toLowerCase() as ecs.Protocol,
            });

            (listener as elb.NetworkListener).addTargets(`${this.parentService.id}-${i}`, {
                deregistrationDelay: Duration.seconds(10),
                port: this.props.listeners[i].port,
                targets: [target],
                proxyProtocolV2: this.props.listeners[i].proxyProtocolV2,
                protocol: this.props.listeners[i].protocol,
                healthCheck: this.props.listeners[i].healthCheck,
            })
        });
    }
}
