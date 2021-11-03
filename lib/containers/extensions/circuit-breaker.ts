import { ServiceBuild, ServiceExtension } from './extension-interfaces';

export class CircuitBreakerExtension extends ServiceExtension {
    constructor() {
        super('circuit-breaker');
    }

    modifyServiceProps(props: ServiceBuild): ServiceBuild {
        return {
            ...props,
            circuitBreaker: { rollback: true },
        };
    }
}
