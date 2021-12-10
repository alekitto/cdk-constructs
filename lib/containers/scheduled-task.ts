import {
    aws_ecs as ecs,
    aws_ecs_patterns as ecs_patterns,
    aws_events as events
} from 'aws-cdk-lib';
import { BaseService } from './base-service';
import { Construct } from 'constructs';
import { EnvironmentCapacityType } from './extensions/extension-interfaces';
import { ServiceProps } from './service';

/**
 * The settings for an ECS Task.
 */
export interface TaskProps extends ServiceProps {
    /**
     * The task schedule.
     */
    readonly schedule: events.Schedule;
}

/**
 * This Service construct serves as a Builder class for an ECS service. It
 * supports various extensions and keeps track of any mutating state, allowing
 * it to build up an ECS service progressively.
 */
export class ScheduledTask extends BaseService {
    /**
     * The underlying ECS service that was created.
     */
    public ecsTask!: ecs_patterns.ScheduledEc2Task | ecs_patterns.ScheduledFargateTask;

    /**
     * The task schedule.
     */
    public readonly schedule: events.Schedule;

    constructor(scope: Construct, id: string, props: TaskProps) {
        super(scope, id, props);
        this.schedule = props.schedule;

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
            // Default CPU and memory
            cpu: '256',
            memoryMiB: '512',

            // Allow user to pre-define the taskRole so that it can be used in resource policies that may
            // Be defined before the ECS service exists in a CDK application
            taskRole: props.taskRole,

            // Ensure that the task definition supports both EC2 and Fargate
            compatibility: ecs.Compatibility.EC2_AND_FARGATE,
        } as ecs.TaskDefinitionProps;

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

        // Now that all containers are created, give each extension a chance
        // To bake its dependency graph
        for (const extensions of Object.keys(this.serviceDescription.extensions)) {
            if (this.serviceDescription.extensions[extensions]) {
                this.serviceDescription.extensions[extensions].resolveContainerDependencies();
            }
        }

        const taskProps = {
            cluster: this.cluster,
            vpc: this.vpc,
            schedule: this.schedule,
            enabled: true,
            desiredTaskCount: 1,
            scheduledEc2TaskDefinitionOptions: {
                taskDefinition: this.taskDefinition,
            },
            scheduledFargateTaskDefinitionOptions: {
                taskDefinition: this.taskDefinition,
            },
        };

        // Now that the service props are determined we can create
        // The service
        if (this.capacityType === EnvironmentCapacityType.EC2) {
            this.ecsTask = new ecs_patterns.ScheduledEc2Task(this.scope, `${this.id}-task`, taskProps);
        } else if (this.capacityType === EnvironmentCapacityType.FARGATE) {
            this.ecsTask = new ecs_patterns.ScheduledFargateTask(this.scope, `${this.id}-task`, taskProps);
        } else {
            throw new Error(`Unknown capacity type for service ${this.id}`);
        }
    }
}
