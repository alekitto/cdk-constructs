import { aws_ec2 as ec2, aws_ecs as ecs } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { EnvironmentCapacityType } from './extensions/extension-interfaces';
import { IEnvironment } from './environment';
import { ServiceDescription } from './service-description';
import { ServiceProps } from './service';

export abstract class BaseService extends Construct {
    /**
     * The name of the service.
     */
    public readonly id: string;

    /**
     * The VPC where this service should be placed.
     */
    public readonly vpc: ec2.IVpc;

    /**
     * The cluster that is providing capacity for this service.
     * [disable-awslint:ref-via-interface]
     */
    public readonly cluster: ecs.ICluster;

    /**
     * The capacity type that this service will use.
     * Valid values are EC2 or FARGATE.
     */
    public readonly capacityType: EnvironmentCapacityType;

    /**
     * The ServiceDescription used to build this service.
     */
    public readonly serviceDescription: ServiceDescription;

    /**
     * The environment where this service was launched.
     */
    public readonly environment: IEnvironment;

    /**
     * The generated task definition for this service. It is only
     * generated after .prepare() has been executed.
     */
    protected taskDefinition!: ecs.TaskDefinition;

    protected readonly scope: Construct;

    constructor(scope: Construct, id: string, props: ServiceProps) {
        super(scope, id);

        this.scope = scope;
        this.id = id;
        this.environment = props.environment;
        this.vpc = props.environment.vpc;
        this.cluster = props.environment.cluster;
        this.capacityType = props.capacityType ?? props.environment.capacityType;
        this.serviceDescription = props.serviceDescription;

        // Check to make sure that the user has actually added a container
        const containerextension = this.serviceDescription.get('service-container');

        if (!containerextension) {
            throw new Error(`Service '${this.id}' must have a Container extension`);
        }

        // First set the scope for all the extensions
        for (const extensions in this.serviceDescription.extensions) {
            if (this.serviceDescription.extensions[extensions]) {
                this.serviceDescription.extensions[extensions].prehook(this, this.scope);
            }
        }
    }

    /**
     * Returns the task network mode from definition.
     */
    get networkMode(): ecs.NetworkMode {
        return this.taskDefinition.networkMode;
    }
}
