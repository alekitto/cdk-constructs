import {
    aws_lambda as lambda,
    aws_iam as iam,
    custom_resources,
    CustomResource,
    Duration,
    Resource,
} from 'aws-cdk-lib';
import * as path from 'path';
import { Construct } from "constructs";

export interface LambdaEdgeFunctionProps {
    /**
     * The source code of your Lambda function.
     * Inline code is not yet supported by LambdaEdgeFunction.
     */
    readonly code: lambda.Code;

    /**
     * The runtime environment for the Lambda function that you are uploading.
     * For valid values, see the Runtime property in the AWS Lambda Developer
     * Guide.
     */
    readonly runtime: lambda.Runtime;

    /**
     * The name of the method within your code that Lambda calls to execute
     * your function. The format includes the file name. It can also include
     * namespaces and other qualifiers, depending on the runtime.
     * For more information, see https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-features.html#gettingstarted-features-programmingmodel.
     */
    readonly handler: string;

    /**
     * The function execution time (in seconds) after which Lambda terminates
     * the function. Because the execution time affects cost, set this value
     * based on the function's expected execution time.
     *
     * @default Duration.seconds(3)
     */
    readonly timeout?: Duration;

    /**
     * The amount of memory, in MB, that is allocated to your Lambda function.
     * Lambda uses this value to proportionally allocate the amount of CPU
     * power. For more information, see Resource Model in the AWS Lambda
     * Developer Guide.
     *
     * @default 128
     */
    readonly memorySize?: number;

    /**
     * Role to use for the custom resource that creates the lambda function.
     *
     * @default - A new role will be created
     */
    readonly customResourceRole?: iam.IRole;
}

export class LambdaEdgeFunction extends Resource {
    public readonly functionArn: string;
    public readonly version: lambda.IVersion;

    constructor(scope: Construct, id: string, props: LambdaEdgeFunctionProps) {
        super(scope, id);

        const config = props.code.bind(this);
        if (config.inlineCode) {
            throw new Error('LambdaEdgeFunction does not support inline code (yet)');
        }

        let role = props.customResourceRole;
        if (! role) {
            role = new iam.Role(this, 'ServiceRole', {
                managedPolicies: [
                    iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
                ],
                assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            });

            (role as iam.Role).assumeRolePolicy!.addStatements(new iam.PolicyStatement({
                actions: [ 'sts:AssumeRole' ],
                principals: [ new iam.ServicePrincipal('edgelambda.amazonaws.com') ],
            }));
        }

        const providerFunction = new lambda.Function(this, 'LambdaEdgeProviderEventHandler', {
            code: lambda.Code.fromAsset(path.resolve(__dirname, 'lambda-packages', 'lambda_edge_resource_provider', 'lib')),
            handler: 'index.requestHandler',
            runtime: lambda.Runtime.NODEJS_12_X,
            timeout: Duration.minutes(1),
        });
        providerFunction.addToRolePolicy(new iam.PolicyStatement({
            actions: [
                'iam:PassRole',
                'lambda:CreateFunction',
                'lambda:DeleteFunction',
                'lambda:PublishVersion',
                'lambda:UpdateFunctionCode',
                's3:GetObject',
            ],
            resources: [ '*' ],
        }));

        const customResourceProvider = new custom_resources.Provider(this, 'LambdaEdgeCustomResourceProvider', {
            onEventHandler: providerFunction,
        });

        const lambdaFn = new CustomResource(this, 'LambdaEdge', {
            serviceToken: customResourceProvider.serviceToken,
            resourceType: 'Custom::LambdaEdgeResource',
            properties: {
                code: config,
                functionName: this.generatePhysicalName() + 'EdgeFn',
                roleArn: role.roleArn,
                handler: props.handler,
                runtime: props.runtime.toString(),
                memorySize: props.memorySize ?? 128,
                timeout: props.timeout?.toSeconds() ?? 3,
            },
        });

        this.functionArn = lambdaFn.getAtt('FunctionArn').toString();
        this.version = lambda.Version.fromVersionArn(this, 'PublishedVersion', this.functionArn + ':' + lambdaFn.getAtt('Version').toString());
    }
}
