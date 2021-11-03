import { ServiceExtension } from './extension-interfaces';

export class TraefikLabelsExtension extends ServiceExtension {
    constructor() {
        super('traefik-labels');
    }

    resolveContainerDependencies() {
        const serviceDescription = this.parentService.serviceDescription;
        for (const extension of Object.keys(serviceDescription.extensions)) {
            const container = serviceDescription.get(extension).container;
            if (! container) {
                continue;
            }

            if ((container as any).props.dockerLabels === undefined) {
                (container as any).props.dockerLabels = {};
            }

            const dockerLabels = (container as any).props.dockerLabels;
            if ('traefik.enable' in dockerLabels) {
                continue;
            }

            dockerLabels['traefik.enable'] = 'false';
        }
    }
}
