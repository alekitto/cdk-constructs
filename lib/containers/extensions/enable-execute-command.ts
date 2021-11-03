import { aws_ecs as ecs, aws_iam as iam } from 'aws-cdk-lib';
import { ServiceBuild, ServiceExtension } from './extension-interfaces';

export class EnableExecuteCommandExtension extends ServiceExtension {
    constructor() {
        super('enable-execute-command');
    }

    useTaskDefinition(taskDefinition: ecs.TaskDefinition) {
        taskDefinition.addToTaskRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'ssmmessages:CreateControlChannel',
                'ssmmessages:CreateDataChannel',
                'ssmmessages:OpenControlChannel',
                'ssmmessages:OpenDataChannel',
            ],
            resources: ['*'],
        }));
    }

    modifyServiceProps(props: ServiceBuild): ServiceBuild {
        return {
            ...props,
            enableExecuteCommand: true
        };
    }
}
