import { aws_ecs as ecs } from 'aws-cdk-lib';
import { ContainerMutatingHook, ServiceExtension } from './extension-interfaces';
import { Container } from './container';

class HealthCheckHook extends ContainerMutatingHook {
    constructor(private healthCheck: ecs.HealthCheck) {
        super();
    }

    mutateContainerDefinition(props: ecs.ContainerDefinitionOptions): ecs.ContainerDefinitionOptions {
        return {
            ...props,
            healthCheck: this.healthCheck,
        };
    }
}

interface HealthCheckProps {
    /**
     * Health check definition to add to the container.
     */
    healthCheck: ecs.HealthCheck,
}

export class HealthCheckExtension extends ServiceExtension {
    private readonly check: ecs.HealthCheck;

    constructor(props: HealthCheckProps) {
        super('health-check');

        this.check = props.healthCheck;
    }

    addHooks() {
        const container = this.parentService.serviceDescription.get('service-container') as Container;
        container.addContainerMutatingHook(new HealthCheckHook(this.check));
    }
}
