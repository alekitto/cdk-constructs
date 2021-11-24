import {
    CustomResource,
    Duration,
    custom_resources as cr,
    aws_ec2 as ec2,
    aws_iam as iam,
    aws_lambda as lambda,
    aws_logs as logs,
    aws_rds as rds
} from 'aws-cdk-lib';
import { Code } from '../lambda';
import { Construct } from 'constructs';

interface PostgresDatabaseProps {
    vpc: ec2.IVpc,
    cluster: rds.IServerlessCluster,
    databaseName: string,
}

export class PostgresDatabase extends Construct {
    constructor(scope: Construct, id: string, props: PostgresDatabaseProps) {
        super(scope, id);

        const onEvent = new lambda.Function(this, 'Handler', {
            runtime: lambda.Runtime.NODEJS_14_X,
            timeout: Duration.minutes(1),
            securityGroups: props.cluster.connections.securityGroups,
            code: Code.fromAsset(__dirname + '/lambda', {
                bundling: {
                    image: lambda.Runtime.NODEJS_14_X.bundlingImage,
                    command: [
                        'sh',
                        '-c',
                        'export npm_config_cache=$(mktemp -d) && cp -r /asset-input/* /asset-output/ && cd /asset-output && npm ci',
                    ],
                },
            }),
            handler: 'index.handler',
            logRetention: logs.RetentionDays.ONE_DAY,
            allowPublicSubnet: true,
        });

        onEvent.role?.attachInlinePolicy(new iam.Policy(this, 'RdsDataServiceAccess', {
            statements: [
                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    actions: [
                        'rds-data:*',
                    ],
                    resources: [
                        props.cluster.clusterArn,
                    ],
                }),
            ],
        }));

        const secret = (props.cluster as rds.ServerlessCluster).secret!;
        secret.grantRead(onEvent);

        const provider = new cr.Provider(this, 'Provider', {
            onEventHandler: onEvent,
            logRetention: logs.RetentionDays.ONE_DAY, // Default is INFINITE
        });

        new CustomResource(this, 'Database', {
            properties: {
                Secret: secret.secretArn,
                ClusterArn: props.cluster.clusterArn,
                Database: props.databaseName,
            },
            serviceToken: provider.serviceToken,
        });
    }
}
