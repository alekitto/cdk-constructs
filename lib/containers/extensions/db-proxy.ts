import {
    aws_ecs as ecs,
    aws_s3 as s3, RemovalPolicy,
} from 'aws-cdk-lib';
import { ServiceExtension } from './extension-interfaces';
import { S3File } from '../../s3-file';

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
}

export class DbProxyExtension extends ServiceExtension {
    private readonly configuration: string;
    private readonly logLevel: string;
    private readonly sentryDsn: string;

    constructor(props: DbProxyExtensionProps) {
        super('db-proxy');

        this.configuration = props.configuration;
        this.logLevel = props.logLevel ?? 'info';
        this.sentryDsn = props.sentryDsn ?? '';
    }

    useTaskDefinition(taskDefinition: ecs.TaskDefinition) {
        let bucket = new s3.Bucket(taskDefinition, 'DbProxyConfigurationBucket', {
            removalPolicy: RemovalPolicy.DESTROY,
        });

        let configurationFile = new S3File(taskDefinition, 'DbProxyConfigurationFile', {
            contents: this.configuration,
            bucket,
        });
        configurationFile.grantRead(taskDefinition.taskRole);

        this.container = taskDefinition.addContainer('db_proxy', {
            image: ecs.ContainerImage.fromRegistry('alekitto/db_proxy:edge'),
            environment: {
                RUST_LOG: this.logLevel,
                SENTRY_DSN: this.sentryDsn,
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

        const appmeshextension = this.parentService.serviceDescription.get('appmesh');
        if (appmeshextension && appmeshextension.container) {
            this.container.addContainerDependencies({
                container: appmeshextension.container,
                condition: ecs.ContainerDependencyCondition.HEALTHY,
            });
        }
    }
}
