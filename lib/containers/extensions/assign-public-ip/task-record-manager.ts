import * as path from 'path';
import {
    CustomResource,
    Duration,
    Fn,
    RemovalPolicy,
    custom_resources,
    aws_dynamodb as dynamodb,
    aws_ecs as ecs,
    aws_events as events,
    aws_events_targets as events_targets,
    aws_iam as iam,
    aws_lambda as lambda,
    aws_lambda_event_sources as lambda_es,
    aws_route53 as route53, aws_sqs as sqs
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface TaskRecordManagerProps {
    service: ecs.Ec2Service | ecs.FargateService;
    dnsZone: route53.IHostedZone;
    dnsRecordName: string;
}

/**
 * An event-driven serverless app to maintain a list of public ips in a Route 53
 * hosted zone.
 */
export class TaskRecordManager extends Construct {
    constructor(scope: Construct, id: string, props: TaskRecordManagerProps) {
        super(scope, id);

        // Poison pills go here.
        const deadLetterQueue = new sqs.Queue(this, 'EventsDL', {
            retentionPeriod: Duration.days(14),
        });

        // Time limit for processing queue items - we set the lambda time limit to
        // This value as well.
        const eventsQueueVisibilityTimeout = Duration.seconds(30);

        // This queue lets us batch together ecs task state events. This is useful
        // For when when we would be otherwise bombarded by them.
        const eventsQueue = new sqs.Queue(this, 'EventsQueue', {
            deadLetterQueue: {
                maxReceiveCount: 500,
                queue: deadLetterQueue,
            },
            visibilityTimeout: eventsQueueVisibilityTimeout,
        });

        // Storage for task and record set information.
        const recordsTable = new dynamodb.Table(this, 'Records', {
            partitionKey: {
                name: 'cluster_service',
                type: dynamodb.AttributeType.STRING,
            },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: RemovalPolicy.DESTROY,
        });

        // Put the cluster's task state changes events into the queue.
        const runningEventRule = new events.Rule(this, 'RuleRunning', {
            eventPattern: {
                source: [ 'aws.ecs' ],
                detailType: [ 'ECS Task State Change' ],
                detail: {
                    clusterArn: [ props.service.cluster.clusterArn ],
                    lastStatus: [ 'RUNNING' ],
                    desiredStatus: [ 'RUNNING' ],
                },
            },
            targets: [
                new events_targets.SqsQueue(eventsQueue),
            ],
        });

        const stoppedEventRule = new events.Rule(this, 'RuleStopped', {
            eventPattern: {
                source: [ 'aws.ecs' ],
                detailType: [ 'ECS Task State Change' ],
                detail: {
                    clusterArn: [ props.service.cluster.clusterArn ],
                    lastStatus: [ 'STOPPED' ],
                    desiredStatus: [ 'STOPPED' ],
                },
            },
            targets: [
                new events_targets.SqsQueue(eventsQueue),
            ],
        });

        // Shared codebase for the lambdas.
        const code = lambda.Code.fromAsset(path.join(__dirname, 'lambda'), {
            exclude: [
                '.coverage',
                '*.pyc',
                '.idea',
            ],
        });

        // Fully qualified domain name of the record
        const recordFqdn = Fn.join('.', [ props.dnsRecordName, props.dnsZone.zoneName ]);

        // Allow access to manage a zone's records.
        const dnsPolicyStatement = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'route53:ChangeResourceRecordSets',
                'route53:ListResourceRecordSets',
            ],
            resources: [ props.dnsZone.hostedZoneArn ],
        });

        // This function consumes events from the event queue and does the work of
        // Querying task IP addresses and creating, updating record sets. When there
        // Are zero tasks, it deletes the record set.
        const eventHandler = new lambda.Function(this, 'EventHandler', {
            code: code,
            handler: 'index.queue_handler',
            runtime: lambda.Runtime.PYTHON_3_8,
            timeout: eventsQueueVisibilityTimeout,
            // Single-concurrency to prevent a race to set the RecordSet
            reservedConcurrentExecutions: 1,
            environment: {
                HOSTED_ZONE_ID: props.dnsZone.hostedZoneId,
                RECORD_NAME: recordFqdn,
                RECORDS_TABLE: recordsTable.tableName,
                CLUSTER_ARN: props.service.cluster.clusterArn,
                SERVICE_NAME: props.service.serviceName,
            },
            events: [
                new lambda_es.SqsEventSource(eventsQueue),
            ],
            initialPolicy: [
                // Look up task IPs
                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    actions: [ 'ec2:DescribeNetworkInterfaces' ],
                    resources: [ '*' ],
                }),
                dnsPolicyStatement,
            ],
        });
        recordsTable.grantReadWriteData(eventHandler);

        // The lambda for a custom resource provider that deletes dangling record
        // Sets when the stack is deleted.
        const cleanupResourceProviderHandler = new lambda.Function(this, 'CleanupResourceProviderHandler', {
            code: code,
            handler: 'index.cleanup_resource_handler',
            runtime: lambda.Runtime.PYTHON_3_8,
            timeout: Duration.minutes(5),
            initialPolicy: [
                dnsPolicyStatement,
            ],
        });

        const cleanupResourceProvider = new custom_resources.Provider(this, 'CleanupResourceProvider', {
            onEventHandler: cleanupResourceProviderHandler,
        });

        const cleanupResource = new CustomResource(this, 'Cleanup', {
            serviceToken: cleanupResourceProvider.serviceToken,
            properties: {
                HostedZoneId: props.dnsZone.hostedZoneId,
                RecordName: recordFqdn,
            },
        });

        // Prime the event queue with a message so that changes to dns config are
        // Quickly applied.
        const primingSdkCall: custom_resources.AwsSdkCall = {
            service: 'SQS',
            action: 'sendMessage',
            parameters: {
                QueueUrl: eventsQueue.queueUrl,
                DelaySeconds: 10,
                MessageBody: '{ "prime": true }',
                // Add the hosted zone id and record name so that priming occurs with
                // Dns config updates.
                MessageAttributes: {
                    HostedZoneId: { DataType: 'String', StringValue: props.dnsZone.hostedZoneId },
                    RecordName: { DataType: 'String', StringValue: props.dnsRecordName },
                },
            },
            physicalResourceId: custom_resources.PhysicalResourceId.fromResponse('MessageId'),
        };

        const primingCall = new custom_resources.AwsCustomResource(this, 'PrimingCall', {
            onCreate: primingSdkCall,
            onUpdate: primingSdkCall,
            policy: custom_resources.AwsCustomResourcePolicy.fromStatements([
                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    actions: [ 'sqs:SendMessage' ],
                    resources: [ eventsQueue.queueArn ],
                }),
            ]),
        });

        // Send the priming call after the handler is created/updated.
        primingCall.node.addDependency(eventHandler);

        // Ensure that the cleanup resource is deleted last (so it can clean up)
        props.service.taskDefinition.node.addDependency(cleanupResource);
        // Ensure that the event rules are created first so we can catch the first
        // State transitions.
        props.service.taskDefinition.node.addDependency(runningEventRule);
        props.service.taskDefinition.node.addDependency(stoppedEventRule);
    }
}
