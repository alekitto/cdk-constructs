import {
    aws_ec2 as ec2,
    aws_ecs as ecs,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Service } from '../service';
import { ServiceExtension } from './extension-interfaces';

/**
 * Setting for the main application container of a service.
 */
export interface ContainerExtensionProps {
    /**
     * How much CPU the container requires.
     */
    readonly cpu?: number,

    /**
     * How much memory in megabytes the container requires.
     */
    readonly memoryMiB: number,

    /**
     * The image to run.
     */
    readonly image: ecs.ContainerImage,

    /**
     * (experimental) The command that is passed to the container.
     *
     * If you provide a shell command as a single string, you have to quote command-line arguments.
     *
     * @default - CMD value built into container image.
     * @experimental
     */
    readonly command?: string[];

    /**
     * (experimental) The ENTRYPOINT value to pass to the container.
     *
     * @default - Entry point configured in container.
     * @see https://docs.docker.com/engine/reference/builder/#entrypoint
     * @experimental
     */
    readonly entryPoint?: string[];

    /**
     * What port the image listen for traffic on.
     */
    readonly trafficPorts: TrafficPort[],

    /**
     * The logging driver to use in this container
     *
     * @default - Undefined
     */
    readonly logging?: ecs.LogDriver,

    /**
     * Environment variables to pass into the container.
     *
     * @default - No environment variables.
     */
    readonly environment?: {
        [key: string]: string,
    }

    /**
     * Docker labels to pass into the container.
     *
     * @default - No labels.
     */
    readonly dockerLabels?: {
        [key: string]: string,
    }
}

export interface TrafficPort {
    port: number;
    protocol?: ecs.Protocol;
}

/**
 * The main container of a service. This is generally the container
 * which runs your application business logic. Other extensions will attach
 * sidecars alongside this main container.
 */
export class Container extends ServiceExtension {
    /**
     * The ports on which the container expects to receive network traffic
     */
    public readonly trafficPorts: TrafficPort[];

    /**
     * The settings for the container.
     */
    private props: ContainerExtensionProps;

    constructor(props: ContainerExtensionProps) {
        super('service-container');
        this.props = props;
        this.trafficPorts = props.trafficPorts;
    }

    // @ts-ignore - Ignore unused params that are required for abstract class extend
    public prehook(service: Service, scope: Construct) {
        this.parentService = service;
    }

    // This hook adds the application container to the task definition.
    public useTaskDefinition(taskDefinition: ecs.TaskDefinition) {
        let containerProps = {
            image: this.props.image,
            command: this.props.command,
            entryPoint: this.props.entryPoint,
            cpu: this.props.cpu ? Number(this.props.cpu) : undefined,
            memoryLimitMiB: Number(this.props.memoryMiB),
            environment: this.props.environment,
            dockerLabels: this.props.dockerLabels,
            logging: this.props.logging,
        } as ecs.ContainerDefinitionOptions;

        // Let other extensions mutate the container definition. This is
        // used by extensions which want to add environment variables, modify
        // logging parameters, etc.
        this.containerMutatingHooks.forEach((hookProvider) => {
            containerProps = hookProvider.mutateContainerDefinition(containerProps);
        });

        this.container = taskDefinition.addContainer('app', containerProps);

        // Create a port mapping for the container
        for (const trafficPort of this.trafficPorts) {
            this.container.addPortMappings({ containerPort: trafficPort.port, protocol: trafficPort.protocol });
        }

        // Raise the ulimits for this main application container
        // so that it can handle more concurrent requests
        this.container.addUlimits({
            softLimit: 1024000,
            hardLimit: 1024000,
            name: ecs.UlimitName.NOFILE,
        });
    }

    resolveServiceDependencies(service: Service) {
        for (const trafficPort of this.trafficPorts) {
            const port = (trafficPort.protocol ?? ecs.Protocol.TCP) === ecs.Protocol.TCP ? ec2.Port.tcp(trafficPort.port) : ec2.Port.udp(trafficPort.port);
            service.ecsService.connections.allowFrom(ec2.Peer.ipv4(service.vpc.vpcCidrBlock), port);
        }
    }

    public resolveContainerDependencies() {
        if (!this.container) {
            throw new Error('The container dependency hook was called before the container was created');
        }

        const firelens = this.parentService.serviceDescription.get('firelens');
        if (firelens && firelens.container) {
            this.container.addContainerDependencies({
                container: firelens.container,
                condition: ecs.ContainerDependencyCondition.START,
            });
        }

        const appmeshextension = this.parentService.serviceDescription.get('appmesh');
        if (appmeshextension && appmeshextension.container) {
            this.container.addContainerDependencies({
                container: appmeshextension.container,
                condition: ecs.ContainerDependencyCondition.HEALTHY,
            });
        }

        const dbproxyextension = this.parentService.serviceDescription.get('db-proxy');
        if (dbproxyextension && dbproxyextension.container) {
            this.container.addContainerDependencies({
                container: dbproxyextension.container,
                condition: ecs.ContainerDependencyCondition.START,
            });
        }

        const cloudwatchextension = this.parentService.serviceDescription.get('cloudwatchAgent');
        if (cloudwatchextension && cloudwatchextension.container) {
            this.container.addContainerDependencies({
                container: cloudwatchextension.container,
                condition: ecs.ContainerDependencyCondition.START,
            });
        }

        const xrayextension = this.parentService.serviceDescription.get('xray');
        if (xrayextension && xrayextension.container) {
            this.container.addContainerDependencies({
                container: xrayextension.container,
                condition: ecs.ContainerDependencyCondition.HEALTHY,
            });
        }
    }
}
