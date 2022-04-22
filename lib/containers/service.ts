import { EnvironmentCapacityType, ServiceBuild } from './extensions/extension-interfaces';
import {
    aws_ecs as ecs,
    aws_iam as iam
} from 'aws-cdk-lib';
import { BaseService } from './base-service';
import { Construct } from 'constructs';
import { IEnvironment } from './environment';
import { ServiceDescription } from './service-description';

/**
 * The settings for an ECS Service.
 */
export interface ServiceProps {
    /**
     * The ServiceDescription used to build the service.
     */
    readonly serviceDescription: ServiceDescription;

    /**
     * The environment to launch the service in.
     */
    readonly environment: IEnvironment

    /**
     * The name of the IAM role that grants containers in the task permission to call AWS APIs on your behalf.
     *
     * @default - A task role is automatically created for you.
     */
    readonly taskRole?: iam.IRole;

    /**
     * The capacity type used by the service.
     *
     * @default - undefined
     * @experimental
     */
    readonly capacityType?: EnvironmentCapacityType;

    /**
     * (experimental) A list of Capacity Provider strategies used to place a service.
     *
     * @default - undefined
     * @experimental
     */
    readonly capacityProviderStrategies?: ecs.CapacityProviderStrategy[];

    /**
     * The operating system that your task definitions are running on.
     * A runtimePlatform is supported only for tasks using the Fargate launch type.
     *
     * @default - Undefined.
     */
    readonly runtimePlatform?: ecs.RuntimePlatform;
}

/**
 * This Service construct serves as a Builder class for an ECS service. It
 * supports various extensions and keeps track of any mutating state, allowing
 * it to build up an ECS service progressively.
 */
export class Service extends BaseService {
    /**
     * The underlying ECS service that was created.
     */
    public ecsService!: ecs.Ec2Service | ecs.FargateService;

    /**
     * The list of URLs associated with this service.
     */
    private urls: Record<string, string> = {};

    constructor(scope: Construct, id: string, props: ServiceProps) {
        super(scope, id, props);

        // At the point of preparation all extensions have been defined on the service
        // So give each extension a chance to now add hooks to other extensions if
        // Needed
        for (const extensions in this.serviceDescription.extensions) {
            if (this.serviceDescription.extensions[extensions]) {
                this.serviceDescription.extensions[extensions].addHooks();
            }
        }

        // Give each extension a chance to mutate the task def creation properties
        let taskDefProps = {
            // Allow user to pre-define the taskRole so that it can be used in resource policies that may
            // Be defined before the ECS service exists in a CDK application
            taskRole: props.taskRole,

            // Ensure that the task definition supports both EC2 and Fargate
            compatibility: ecs.Compatibility.EC2_AND_FARGATE,

            // Set the correct runtime platform
            runtimePlatform: props.runtimePlatform,
        } as ecs.TaskDefinitionProps;

        if (this.capacityType === EnvironmentCapacityType.FARGATE) {
            taskDefProps = {
                ...taskDefProps,
                cpu: '256',
                memoryMiB: '512',
            };
        }

        for (const extensions of Object.keys(this.serviceDescription.extensions)) {
            if (this.serviceDescription.extensions[extensions]) {
                taskDefProps = this.serviceDescription.extensions[extensions].modifyTaskDefinitionProps(taskDefProps);
            }
        }

        // Now that the task definition properties are assembled, create it
        this.taskDefinition = new ecs.TaskDefinition(this.scope, `${this.id}-task-definition`, taskDefProps);

        // Now give each extension a chance to use the task definition
        for (const extensions of Object.keys(this.serviceDescription.extensions)) {
            if (this.serviceDescription.extensions[extensions]) {
                this.serviceDescription.extensions[extensions].useTaskDefinition(this.taskDefinition);
            }
        }

        if (this.capacityType === EnvironmentCapacityType.EC2) {
            let memory = 0;
            for (const extensions of Object.keys(this.serviceDescription.extensions)) {
                if (this.serviceDescription.extensions[extensions]) {
                    const container = this.serviceDescription.extensions[extensions].container;
                    if (container) {
                        const props = (container as any).props;
                        memory += props.memoryReservationMiB ?? props.memoryLimitMiB;
                    }
                }
            }

            const node = this.taskDefinition.node.findChild('Resource') as ecs.CfnTaskDefinition;
            node.memory = String(memory || 256);
        }

        // Now that all containers are created, give each extension a chance
        // To bake its dependency graph
        for (const extensions of Object.keys(this.serviceDescription.extensions)) {
            if (this.serviceDescription.extensions[extensions]) {
                this.serviceDescription.extensions[extensions].resolveContainerDependencies();
            }
        }

        // Give each extension a chance to mutate the service props before
        // Service creation
        let serviceProps = {
            cluster: this.cluster,
            taskDefinition: this.taskDefinition,
            minHealthyPercent: 100,
            maxHealthyPercent: 200,
            desiredCount: 1,
        } as ServiceBuild;

        for (const extensions of Object.keys(this.serviceDescription.extensions)) {
            if (this.serviceDescription.extensions[extensions]) {
                serviceProps = this.serviceDescription.extensions[extensions].modifyServiceProps(serviceProps);
            }
        }

        // If a maxHealthyPercent and desired count has been set while minHealthyPercent == 100% then we
        // Need to do some failsafe checking to ensure that the maxHealthyPercent
        // Actually allows a rolling deploy. Otherwise it is possible to end up with
        // Blocked deploys that can take no action because minHealtyhPercent == 100%
        // Prevents running, healthy tasks from being stopped, but a low maxHealthyPercent
        // Can also prevents new parallel tasks from being started.
        if (serviceProps.maxHealthyPercent && serviceProps.desiredCount && serviceProps.minHealthyPercent && 100 == serviceProps.minHealthyPercent) {
            if (1 == serviceProps.desiredCount) {
                // If there is one task then we must allow max percentage to be at
                // Least 200% for another replacement task to be added
                serviceProps = {
                    ...serviceProps,
                    maxHealthyPercent: Math.max(200, serviceProps.maxHealthyPercent),
                };
            } else if (3 >= serviceProps.desiredCount) {
                // If task count is 2 or 3 then max percent must be at least 150% to
                // Allow one replacement task to be launched at a time.
                serviceProps = {
                    ...serviceProps,
                    maxHealthyPercent: Math.max(150, serviceProps.maxHealthyPercent),
                };
            } else {
                // For anything higher than 3 tasks set max percent to at least 125%
                // For 4 tasks this will allow exactly one extra replacement task
                // At a time, for any higher task count it will allow 25% of the tasks
                // To be replaced at a time.
                serviceProps = {
                    ...serviceProps,
                    maxHealthyPercent: Math.max(125, serviceProps.maxHealthyPercent),
                };
            }
        }

        if (0 < (props.capacityProviderStrategies ?? []).length) {
            serviceProps = {
                ...serviceProps,
                capacityProviderStrategies: props.capacityProviderStrategies,
            };
        }

        // Now that the service props are determined we can create
        // The service
        if (this.capacityType === EnvironmentCapacityType.EC2) {
            this.ecsService = new ecs.Ec2Service(this.scope, `${this.id}-service`, serviceProps);
        } else if (this.capacityType === EnvironmentCapacityType.FARGATE) {
            this.ecsService = new ecs.FargateService(this.scope, `${this.id}-service`, serviceProps);
        } else {
            throw new Error(`Unknown capacity type for service ${this.id}`);
        }

        // Now give all extensions a chance to use the service
        for (const extensions of Object.keys(this.serviceDescription.extensions)) {
            if (this.serviceDescription.extensions[extensions]) {
                this.serviceDescription.extensions[extensions].useService(this.ecsService);
            }
        }

        for (const extensions of Object.keys(this.serviceDescription.extensions)) {
            if (this.serviceDescription.extensions[extensions]) {
                this.serviceDescription.extensions[extensions].resolveServiceDependencies(this);
            }
        }
    }

    /**
     * Tell extensions from one service to connect to extensions from
     * another service if they have implemented a hook for it.
     *
     * @param service
     */
    public connectTo(service: Service) {
        for (const extensions of Object.keys(this.serviceDescription.extensions)) {
            if (this.serviceDescription.extensions[extensions]) {
                this.serviceDescription.extensions[extensions].connectToService(service);
            }
        }
    }

    /**
     * This method adds a new URL for the service. This allows extensions to
     * submit a URL for the service. For example, a load balancer might add its
     * URL, or App Mesh can add its DNS name for the service.
     *
     * @param urlName - The identifier name for this URL
     * @param url - The URL itself.
     */
    public addURL(urlName: string, url: string) {
        this.urls[urlName] = url;
    }

    /**
     * Retrieve a URL for the service. The URL must have previously been
     * stored by one of the URL providing extensions.
     *
     * @param urlName - The URL to look up.
     */
    public getURL(urlName: string) {
        if (!this.urls[urlName]) {
            throw new Error(`Unable to find a URL with name '${urlName}'`);
        }

        return this.urls[urlName];
    }
}
