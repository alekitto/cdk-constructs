import * as appmesh from '../../appmesh';
import {
    CfnMapping,
    Duration,
    Stack,
    aws_ec2 as ec2,
    aws_ecr as ecr,
    aws_ecs as ecs,
    aws_iam as iam,
    region_info
} from 'aws-cdk-lib';
import { Container, TrafficPort } from './container';
import { ServiceBuild, ServiceExtension } from './extension-interfaces';
import { Construct } from 'constructs';
import { Service } from '../service';

// The version of the App Mesh envoy sidecar to add to the task.
const APP_MESH_ENVOY_SIDECAR_VERSION = 'v1.20.0.1-prod';
const meshNameCleanup = (name: string) => name.replace(/[^a-zA-Z0-9\-_]+/g, '-');

/**
 * The settings for the App Mesh extension.
 */
export interface MeshProps {
    /**
     * The service mesh into which to register the service.
     */
    readonly mesh: appmesh.Mesh;

    /**
     * The protocol of the service.
     * Valid values are Protocol.HTTP, Protocol.HTTP2, Protocol.TCP, Protocol.GRPC
     * @default - Protocol.HTTP
     */
    readonly protocol?: appmesh.Protocol;

    /**
     * The envoy image tag to use
     * @default APP_MESH_ENVOY_SIDECAR_VERSION
     */
    readonly envoyVersion?: string;

    /**
     * The mesh traffic port
     * @default The first service traffic port.
     */
    readonly trafficPort?: TrafficPort;

    /**
     * (experimental) The egress traffic going to these specified ports is ignored and not redirected to the ProxyEgressPort.
     *
     * It can be an empty list.
     *
     * @experimental
     */
    readonly egressIgnoredPorts?: number[];
}

/**
 * This extension adds an Envoy sidecar to the task definition and
 * creates the App Mesh resources required to route network traffic
 * to the container in a service mesh.
 *
 * The service will then be available to other App Mesh services at the
 * address `<service name>.<environment name>`. For example, a service called
 * `orders` deploying in an environment called `production` would be accessible
 * to other App Mesh enabled services at the address `http://orders.production`.
 */
export class AppMeshExtension extends ServiceExtension {
    protected virtualNode!: appmesh.VirtualNode;
    protected virtualService!: appmesh.VirtualService;
    protected virtualRouter!: appmesh.VirtualRouter;
    protected route!: appmesh.Route;
    private readonly mesh: appmesh.Mesh;
    private readonly envoyVersion: string;
    private trafficPort: null | TrafficPort;
    private readonly egressIgnoredPorts: number[];

    /**
     * The protocol used for AppMesh routing.
     * default - Protocol.HTTP
     */
    public readonly protocol: appmesh.Protocol;

    constructor(props: MeshProps) {
        super('appmesh');
        this.mesh = props.mesh;
        this.envoyVersion = props.envoyVersion ?? APP_MESH_ENVOY_SIDECAR_VERSION;
        this.trafficPort = props.trafficPort ?? null;
        this.egressIgnoredPorts = props.egressIgnoredPorts ?? [];

        if (props.protocol) {
            this.protocol = props.protocol;
        } else {
            this.protocol = appmesh.Protocol.HTTP;
        }
    }

    public prehook(service: Service, scope: Construct) {
        this.parentService = service;
        this.scope = scope;

        // Make sure that the parent cluster for this service has
        // A namespace attached.
        if (!this.parentService.cluster.defaultCloudMapNamespace) {
            this.parentService.environment.addDefaultCloudMapNamespace({
                // Name the namespace after the environment name.
                // Service DNS will be like <service id>.<environment id>
                name: this.parentService.environment.id,
            });
        }
    }

    public modifyTaskDefinitionProps(props: ecs.TaskDefinitionProps): ecs.TaskDefinitionProps {
        // Find the app extension, to get its port
        const containerextension = this.parentService.serviceDescription.get('service-container') as Container;
        if (!containerextension) {
            throw new Error('Appmesh extension requires an application extension');
        }

        this.trafficPort = this.trafficPort ?? containerextension.trafficPorts[0];

        return {
            ...props,

            // App Mesh requires AWS VPC networking mode so that each
            // Task can have its own IP address
            networkMode: ecs.NetworkMode.AWS_VPC,

            // This configures the envoy container as a proxy for all
            // Traffic going into and out of the task, with a few exceptions
            // For metadata endpoints or other ports that need direct
            // Communication
            proxyConfiguration: new ecs.AppMeshProxyConfiguration({
                containerName: 'envoy',
                properties: {
                    appPorts: [ this.trafficPort.port ],
                    proxyEgressPort: 15001,
                    proxyIngressPort: 15000,

                    // The App Mesh proxy runs with this user ID, and this keeps its
                    // Own outbound connections from recursively attempting to infinitely proxy.
                    ignoredUID: 1337,

                    // This GID is ignored and any outbound traffic originating from containers that
                    // Use this group ID will be ignored by the proxy. This is primarily utilized by
                    // The FireLens extension, so that outbound application logs don't have to go through Envoy
                    // And therefore add extra burden to the proxy sidecar. Instead the logs can go directly
                    // To CloudWatch
                    ignoredGID: 1338,

                    egressIgnoredIPs: [
                        '169.254.170.2', // Allow services to talk directly to ECS metadata endpoints
                        '169.254.169.254', // And EC2 instance endpoint
                    ],

                    // If there is outbound traffic to specific ports that you want to
                    // Ignore the proxy those ports can be added here.
                    egressIgnoredPorts: this.egressIgnoredPorts,
                },
            }),
        } as ecs.TaskDefinitionProps;
    }

    private accountIdForRegion(region: string) {
        return { ecrRepo: region_info.RegionInfo.get(region).appMeshRepositoryAccount };
    }

    public useTaskDefinition(taskDefinition: ecs.TaskDefinition) {
        const region = Stack.of(this.scope).region;

        // This is currently necessary because App Mesh has different images in each region,
        // And some regions have their images in a different account. See:
        // https://docs.aws.amazon.com/app-mesh/latest/userguide/envoy.html
        const mapping = new CfnMapping(this.scope, `${this.parentService.id}-envoy-image-account-mapping`, {
            lazy: true,
            mapping: {
                'ap-northeast-1': this.accountIdForRegion('ap-northeast-1'),
                'ap-northeast-2': this.accountIdForRegion('ap-northeast-2'),
                'ap-south-1': this.accountIdForRegion('ap-south-1'),
                'ap-southeast-1': this.accountIdForRegion('ap-southeast-1'),
                'ap-southeast-2': this.accountIdForRegion('ap-southeast-1'),
                'ca-central-1': this.accountIdForRegion('ca-central-1'),
                'eu-central-1': this.accountIdForRegion('eu-central-1'),
                'eu-north-1': this.accountIdForRegion('eu-north-1'),
                'eu-south-1': this.accountIdForRegion('eu-south-1'),
                'eu-west-1': this.accountIdForRegion('eu-west-1'),
                'eu-west-2': this.accountIdForRegion('eu-west-2'),
                'eu-west-3': this.accountIdForRegion('eu-west-3'),
                'sa-east-1': this.accountIdForRegion('sa-east-1'),
                'us-east-1': this.accountIdForRegion('us-east-1'),
                'us-east-2': this.accountIdForRegion('us-east-2'),
                'us-west-1': this.accountIdForRegion('us-west-1'),
                'us-west-2': this.accountIdForRegion('us-west-2'),

                'me-south-1': this.accountIdForRegion('me-south-1'),
                'ap-east-1': this.accountIdForRegion('ap-east-1'),
                'af-south-1': this.accountIdForRegion('af-south-1'),
            },
        });

        // WHEN
        const ownerAccount = mapping.findInMap(region, 'ecrRepo');

        const appMeshRepo = ecr.Repository.fromRepositoryAttributes(
            this.scope,
            `${this.parentService.id}-envoy-repo`,
            {
                repositoryName: 'aws-appmesh-envoy',
                repositoryArn: `arn:aws:ecr:${region}:${ownerAccount}:repository/aws-appmesh-envoy`,
            },
        );

        this.container = taskDefinition.addContainer('envoy', {
            image: ecs.ContainerImage.fromEcrRepository(appMeshRepo, this.envoyVersion),
            essential: true,
            environment: {
                APPMESH_VIRTUAL_NODE_NAME: `mesh/${this.mesh.meshName}/virtualNode/${meshNameCleanup(this.parentService.id)}`,
                AWS_REGION: Stack.of(this.parentService).region,
                ENABLE_ENVOY_STATS_TAGS: '1',
                ENABLE_ENVOY_DOG_STATSD: '1',
            },
            healthCheck: {
                command: [
                    'CMD-SHELL',
                    'curl -s http://localhost:9901/server_info | grep state | grep -q LIVE',
                ],
                startPeriod: Duration.seconds(10),
                interval: Duration.seconds(5),
                timeout: Duration.seconds(2),
            },
            memoryReservationMiB: 128,
            user: '1337',
            logging: ecs.AwsLogDriver.awsLogs({ streamPrefix: 'envoy' }),
        });

        // Modify the task definition role to allow the Envoy sidecar to get
        // Configuration from the Envoy control plane, for this particular
        // Mesh only.
        taskDefinition.addToTaskRolePolicy(new iam.PolicyStatement({
            resources: [
                this.mesh.meshArn,
                this.mesh.meshArn + '/*',
            ],
            actions: [ 'appmesh:StreamAggregatedResources' ],
        }));

        // Raise the number of open file descriptors allowed. This is
        // Necessary when the Envoy proxy is handling large amounts of
        // Traffic.
        this.container.addUlimits({
            softLimit: 1024000,
            hardLimit: 1024000,
            name: ecs.UlimitName.NOFILE,
        });
    }

    // Enable CloudMap for the service.
    public modifyServiceProps(props: ServiceBuild): ServiceBuild {
        return {
            ...props,

            // Ensure that service tasks are registered into
            // CloudMap so that the App Mesh proxy can find them.
            cloudMapOptions: {
                dnsRecordType: 'A',
                dnsTtl: Duration.seconds(10),
                failureThreshold: 2,
                name: this.parentService.id,
            },

            // These specific deployment settings are currently required in order to
            // Maintain availability during a rolling deploy of the service with App Mesh
            // https://docs.aws.amazon.com/app-mesh/latest/userguide/best-practices.html#reduce-deployment-velocity
            minHealthyPercent: 100,
            maxHealthyPercent: 125, // Note that at low task count the Service will boost this setting higher
        } as ServiceBuild;
    }

    // Now that the service is defined, we can create the AppMesh virtual service
    // And virtual node for the real service
    public useService(service: ecs.Ec2Service | ecs.FargateService) {
        const containerextension = this.parentService.serviceDescription.get('service-container') as Container;
        if (!containerextension) {
            throw new Error('Firelens extension requires an application extension');
        }

        this.trafficPort = this.trafficPort ?? containerextension.trafficPorts[0];
        const cloudmapNamespace = this.parentService.cluster.defaultCloudMapNamespace;

        if (!cloudmapNamespace) {
            throw new Error('You must add a CloudMap namespace to the ECS cluster in order to use the AppMesh extension');
        }

        function addListener(protocol: appmesh.Protocol, port: number): appmesh.VirtualNodeListener {
            switch (protocol) {
                case appmesh.Protocol.HTTP :
                    return appmesh.VirtualNodeListener.http({ port });

                case appmesh.Protocol.HTTP2 :
                    return appmesh.VirtualNodeListener.http2({ port });

                case appmesh.Protocol.GRPC :
                    return appmesh.VirtualNodeListener.grpc({ port });

                case appmesh.Protocol.TCP :
                    return appmesh.VirtualNodeListener.tcp({ port });
            }
        }

        // Create a virtual node for the name service
        this.virtualNode = new appmesh.VirtualNode(this.scope, `${this.parentService.id}-virtual-node`, {
            mesh: this.mesh,
            virtualNodeName: meshNameCleanup(this.parentService.id),
            serviceDiscovery: service.cloudMapService
                ? appmesh.ServiceDiscovery.cloudMap({
                    service: service.cloudMapService,
                })
                : undefined,
            listeners: [ addListener(this.protocol, this.trafficPort.port) ],
        });

        // Create a virtual router for this service. This allows for retries
        // And other similar behaviors.
        this.virtualRouter = new appmesh.VirtualRouter(this.scope, `${this.parentService.id}-virtual-router`, {
            mesh: this.mesh,
            listeners: [ this.virtualRouterListener(this.trafficPort.port) ],
            virtualRouterName: meshNameCleanup(this.parentService.id),
        });

        // Form the service name that requests will be made to
        const serviceName = `${this.parentService.id}.${cloudmapNamespace.namespaceName}`;
        const weightedTargets: appmesh.WeightedTarget[] = [ {
            virtualNode: this.virtualNode,
            weight: 1,
        } ];
        // Now add the virtual node as a route in the virtual router
        // Ensure that the route type matches the protocol type.
        this.route = this.virtualRouter.addRoute(`${meshNameCleanup(this.parentService.id)}-route`, {
            routeSpec: this.routeSpec(weightedTargets, serviceName),
        });

        // Now create a virtual service. Relationship goes like this:
        // Virtual service -> virtual router -> virtual node
        this.virtualService = new appmesh.VirtualService(this.scope, `${this.parentService.id}-virtual-service`, {
            virtualServiceProvider: appmesh.VirtualServiceProvider.virtualRouter(this.virtualRouter),
            virtualServiceName: serviceName,
        });
    }

    // Connect the app mesh extension for this service to an app mesh
    // Extension on another service.
    public connectToService(otherService: Service) {
        if (! (this.parentService instanceof Service)) {
            return;
        }

        const otherAppMesh = otherService.serviceDescription.get('appmesh') as AppMeshExtension;
        const otherContainer = otherService.serviceDescription.get('service-container') as Container;

        // Do a check to ensure that these services are in the same environment.
        // Currently this extension only supports connecting services within
        // The same VPC, same App Mesh service mesh, and same Cloud Map namespace
        if (otherAppMesh.parentService.environment.id !== this.parentService.environment.id) {
            throw new Error(`Unable to connect service '${this.parentService.id}' in environment '${this.parentService.environment.id}' to service '${otherService.id}' in environment '${otherAppMesh.parentService.environment.id}' because services can not be connected across environment boundaries`);
        }

        const trafficPort = this.trafficPort ?? otherContainer.trafficPorts[0];
        const port = (trafficPort.protocol ?? ecs.Protocol.TCP) === ecs.Protocol.TCP ? ec2.Port.tcp(trafficPort.port) : ec2.Port.udp(trafficPort.port);

        // First allow this service to talk to the other service
        // At a network level. This opens the security groups so that
        // The security groups of these two services to each other
        this.parentService.ecsService.connections.allowTo(otherService.ecsService, port, `Accept inbound traffic from ${this.parentService.id}`);

        // Next update the app mesh config so that the local Envoy
        // Proxy on this service knows how to route traffic to
        // Nodes from the other service.
        this.virtualNode.addBackend(appmesh.Backend.virtualService(otherAppMesh.virtualService));
    }

    private routeSpec(weightedTargets: appmesh.WeightedTarget[], serviceName: string): appmesh.RouteSpec {
        switch (this.protocol) {
            case appmesh.Protocol.HTTP: return appmesh.RouteSpec.http({
                weightedTargets: weightedTargets,
            });
            case appmesh.Protocol.HTTP2: return appmesh.RouteSpec.http2({
                weightedTargets: weightedTargets,
            });
            case appmesh.Protocol.GRPC: return appmesh.RouteSpec.grpc({
                weightedTargets: weightedTargets,
                match: {
                    serviceName: serviceName,
                },
            });
            case appmesh.Protocol.TCP: return appmesh.RouteSpec.tcp({
                weightedTargets: weightedTargets,
            });
        }
    }

    private virtualRouterListener(port: number): appmesh.VirtualRouterListener {
        switch (this.protocol) {
            case appmesh.Protocol.HTTP: return appmesh.VirtualRouterListener.http(port);
            case appmesh.Protocol.HTTP2: return appmesh.VirtualRouterListener.http2(port);
            case appmesh.Protocol.GRPC: return appmesh.VirtualRouterListener.grpc(port);
            case appmesh.Protocol.TCP: return appmesh.VirtualRouterListener.tcp(port);
        }
    }
}
