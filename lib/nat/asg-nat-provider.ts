import {
    Duration, Tags,
    aws_autoscaling as asg,
    aws_ec2 as ec2,
    aws_events as events,
    aws_events_targets as events_targets,
    aws_iam as iam,
    aws_lambda as lambda
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

/**
 * NAT provider which uses NAT Instances
 */
export class NatAsgProvider extends ec2.NatProvider implements ec2.IConnectable {
    private _securityGroup?: ec2.ISecurityGroup;
    private _connections?: ec2.Connections;

    constructor(private readonly scope: Construct, private readonly props: ec2.NatInstanceProps) {
        super();

        if (props.defaultAllowedTraffic !== undefined && props.allowAllTraffic !== undefined) {
            throw new Error('Can not specify both of \'defaultAllowedTraffic\' and \'defaultAllowedTraffic\'; prefer \'defaultAllowedTraffic\'');
        }
    }

    public configureNat(options: ec2.ConfigureNatOptions) {
        const defaultDirection = this.props.defaultAllowedTraffic ??
            (this.props.allowAllTraffic ?? true ? ec2.NatTrafficDirection.INBOUND_AND_OUTBOUND : ec2.NatTrafficDirection.OUTBOUND_ONLY);

        // Create the NAT instances. They can share a security group and a Role.
        const machineImage = this.props.machineImage || new ec2.NatInstanceImage();
        this._securityGroup = this.props.securityGroup ?? new ec2.SecurityGroup(this.scope, 'NatSecurityGroup', {
            vpc: options.vpc,
            description: 'Security Group for NAT instances',
            allowAllOutbound: isOutboundAllowed(defaultDirection),
        });

        this._connections = new ec2.Connections({ securityGroups: [ this._securityGroup ] });

        if (isInboundAllowed(defaultDirection)) {
            this.connections.allowFromAnyIpv4(ec2.Port.allTraffic());
        }

        // Add routes to them in the private subnets
        for (const sub of options.privateSubnets) {
            this.configureSubnet(sub);
        }

        const lambraRole = new iam.Role(this.scope, 'ConfigureNatLambdaRole', {
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
                iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2FullAccess'),
                iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonVPCFullAccess'),
            ],
            assumedBy: new iam.CompositePrincipal(
                new iam.ServicePrincipal('events.amazonaws.com'),
                new iam.ServicePrincipal('lambda.amazonaws.com'),
            ),
            inlinePolicies: {
                inline: new iam.PolicyDocument({
                    statements: [ new iam.PolicyStatement({
                        actions: [ 'lambda:*' ],
                        effect: iam.Effect.ALLOW,
                        resources: [ '*' ],
                    }) ],
                }),
            },
        });

        const configurationLambda = new lambda.Function(this.scope, 'ConfigureNatAsg', {
            allowPublicSubnet: true,
            handler: 'index.lambda_handler',
            code: lambda.Code.fromAsset(__dirname + '/lambda/configure-nat'),
            timeout: Duration.seconds(15),
            runtime: lambda.Runtime.PYTHON_3_8,
            role: lambraRole,
        });

        const eventRule = new events.Rule(this.scope, 'Ec2EventRule', {
            enabled: true,
            eventPattern: {
                source: [ 'aws.ec2' ],
                detailType: [ 'EC2 Instance State-change Notification' ],
            },
            targets: [ new events_targets.LambdaFunction(configurationLambda) ],
        });

        const natGroup = new asg.AutoScalingGroup(this.scope, 'NATAutoScalingGroup', {
            vpc: options.vpc,
            instanceType: this.props.instanceType,
            machineImage,
            vpcSubnets: { subnets: options.natSubnets },
            securityGroup: this._securityGroup,
            keyName: this.props.keyName,
        });

        natGroup.node.addDependency(eventRule);
        Tags.of(natGroup).add('Name', 'asg-nat-instance', {
            applyToLaunchedInstances: true,
        });
    }

    /**
     * The Security Group associated with the NAT instances
     */
    public get securityGroup(): ec2.ISecurityGroup {
        if (!this._securityGroup) {
            throw new Error('Pass the NatInstanceProvider to a Vpc before accessing \'securityGroup\'');
        }

        return this._securityGroup;
    }

    /**
     * Manage the Security Groups associated with the NAT instances
     */
    public get connections(): ec2.Connections {
        if (!this._connections) {
            throw new Error('Pass the NatInstanceProvider to a Vpc before accessing \'connections\'');
        }

        return this._connections;
    }

    public get configuredGateways(): ec2.GatewayConfig[] {
        return [];
    }

    public configureSubnet(subnet: ec2.PrivateSubnet) {
        Tags.of(subnet).add('AllowNatRouteUpdates', 'N/A');
    }
}

function isOutboundAllowed(direction: ec2.NatTrafficDirection) {
    return direction === ec2.NatTrafficDirection.INBOUND_AND_OUTBOUND ||
        direction === ec2.NatTrafficDirection.OUTBOUND_ONLY;
}

function isInboundAllowed(direction: ec2.NatTrafficDirection) {
    return direction === ec2.NatTrafficDirection.INBOUND_AND_OUTBOUND;
}
