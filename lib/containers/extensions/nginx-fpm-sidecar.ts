import {
    aws_ec2 as ec2,
    aws_ecs as ecs,
} from 'aws-cdk-lib';
import { ServiceExtension } from './extension-interfaces';
import { Service } from "../service";

const NGINX_PHP_IMAGE = 'alekitto/nginx-ecs-php-fpm:latest';
interface NginxFpmSidecarExtensionProps {
    /**
     * The nginx image to use.
     * @default - NGINX_PHP_IMAGE
     */
    readonly image?: string;

    /**
     * The php document root
     * @default - /app/public
     */
    readonly documentRoot?: string;

    /**
     * The php fast cgi hostname
     *
     * @default - 127.0.0.1
     */
    readonly fcgiHostname?: string;

    /**
     * Docker labels to pass into the container.
     *
     * @default - No labels.
     */
    readonly dockerLabels?: {
        [key: string]: string,
    };
}

export class NginxFpmSidecarExtension extends ServiceExtension {
    private readonly image: string;
    private readonly documentRoot: string;
    private readonly fcgiHostname: string;
    private readonly dockerLabels: { [key: string]: string };

    constructor(props: NginxFpmSidecarExtensionProps = {}) {
        super('nginx-fpm-sidecar');

        this.image = props.image ?? NGINX_PHP_IMAGE;
        this.documentRoot = props.documentRoot ?? '/app/public';
        this.fcgiHostname = props.fcgiHostname ?? '127.0.0.1';
        this.dockerLabels = props.dockerLabels ?? {};
    }

    useTaskDefinition(taskDefinition: ecs.TaskDefinition) {
        this.container = taskDefinition.addContainer('nginx-fpm-sidecar', {
            image: ecs.ContainerImage.fromRegistry(this.image),
            environment: {
                DOCUMENT_ROOT: this.documentRoot,
                PHP_FCGI_HOSTNAME: this.fcgiHostname,
            },
            essential: true,
            memoryLimitMiB: 32,
            logging: ecs.LogDriver.awsLogs({ streamPrefix: 'nginx' }),
            dockerLabels: this.dockerLabels,
        });

        this.container.addPortMappings({ containerPort: 80 });
    }

    resolveServiceDependencies(service: Service) {
        service.ecsService.connections
            .allowFrom(ec2.Peer.ipv4(service.vpc.vpcCidrBlock), ec2.Port.tcp(80))
    }

    public resolveContainerDependencies() {
        if (!this.container) {
            throw new Error('The container dependency hook was called before the container was created');
        }

        const appmeshextension = this.parentService.serviceDescription.get('appmesh');
        if (appmeshextension && appmeshextension.container) {
            this.container.addContainerDependencies({
                container: appmeshextension.container,
                condition: ecs.ContainerDependencyCondition.HEALTHY,
            });
        }

        const app = this.parentService.serviceDescription.get('service-container');
        if (app && app.container) {
            this.container.addContainerDependencies({
                container: app.container,
                condition: ecs.ContainerDependencyCondition.START,
            });
        }
    }
}
