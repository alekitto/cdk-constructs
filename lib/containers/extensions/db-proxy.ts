import {
    RemovalPolicy,
    Stack,
    aws_ecs as ecs,
    aws_s3 as s3
} from 'aws-cdk-lib';
import { Container } from './container';
import { S3File } from '../../s3-file';
import { ServiceExtension } from './extension-interfaces';

interface DbProxyExtensionProps {
    /**
     * The configuration file content.
     */
    readonly configuration: string;

    /**
     * The db proxy log level (error, warn, info, debug, trace)
     * @default info
     */
    readonly logLevel?: string;

    /**
     * The db proxy sentry DSN
     * @default empty
     */
    readonly sentryDsn?: string;

    /**
     * (experimental) The health check command and associated configuration parameters for the container.
     * @experimental
     */
    readonly healthCheck?: ecs.HealthCheck;
}

export class DbProxyExtension extends ServiceExtension {
    private readonly configuration: string;
    private readonly logLevel: string;
    private readonly sentryDsn: string;
    private readonly healthCheck: ecs.HealthCheck | undefined;

    constructor(props: DbProxyExtensionProps) {
        super('db-proxy');

        this.configuration = props.configuration;
        this.logLevel = props.logLevel ?? 'info';
        this.sentryDsn = props.sentryDsn ?? '';
        this.healthCheck = props.healthCheck;
    }

    useTaskDefinition(taskDefinition: ecs.TaskDefinition) {
        const bucket = new s3.Bucket(taskDefinition, 'DbProxyConfigurationBucket', {
            removalPolicy: RemovalPolicy.DESTROY,
        });

        const configurationFile = new S3File(taskDefinition, 'DbProxyConfigurationFile', {
            contents: this.configuration,
            bucket,
        });

        configurationFile.grantRead(taskDefinition.taskRole);

        this.container = taskDefinition.addContainer('db_proxy', {
            image: ecs.ContainerImage.fromRegistry('alekitto/db_proxy:edge'),
            healthCheck: this.healthCheck,
            environment: {
                RUST_LOG: this.logLevel,
                SENTRY_DSN: this.sentryDsn,
                AWS_DEFAULT_REGION: Stack.of(taskDefinition).region,
            },
            command: [
                '-c',
                's3://' + bucket.bucketName + '/' + configurationFile.objectKey,
            ],
            essential: true,
            memoryLimitMiB: 64,
            logging: ecs.LogDriver.awsLogs({ streamPrefix: 'db-proxy' }),
        });
    }

    public resolveContainerDependencies() {
        if (!this.container) {
            throw new Error('The container dependency hook was called before the container was created');
        }

        const container = this.parentService.serviceDescription.get('service-container') as Container;
        if (container.container && this.parentService.networkMode == ecs.NetworkMode.BRIDGE) {
            container.container.addLink(this.container, 'db_proxy');
        }

        if (undefined !== this.healthCheck) {
            container.container!.addContainerDependencies({
                container: this.container,
                condition: ecs.ContainerDependencyCondition.HEALTHY,
            });
        }

        const appmeshextension = this.parentService.serviceDescription.get('appmesh');
        if (appmeshextension && appmeshextension.container) {
            this.container.addContainerDependencies({
                container: appmeshextension.container,
                condition: ecs.ContainerDependencyCondition.HEALTHY,
            });
        }
    }
}
