import { Construct, IConstruct } from 'constructs';
import { Fn, aws_ec2 as ec2 } from 'aws-cdk-lib';
import { valueOrDie } from '..';

interface Ipv6VpcProps extends ec2.VpcProps {
    ipv6CidrBlock?: string;
    ipv6Pool?: string;
    useAmazonProvidedIpv6CidrBlock?: boolean;
    ipv6Native?: boolean;
}

export class Ipv6Vpc extends ec2.Vpc {
    constructor(scope: Construct, id: string, props?: Ipv6VpcProps) {
        super(scope, id, props);

        const ip6cidr = new ec2.CfnVPCCidrBlock(this, 'Cidr6', {
            vpcId: this.vpcId,
            amazonProvidedIpv6CidrBlock:
                props?.useAmazonProvidedIpv6CidrBlock ??
                (!props?.ipv6CidrBlock && !props?.ipv6Pool),
            ipv6Pool: props?.ipv6Pool,
            ipv6CidrBlock: props?.ipv6CidrBlock,
        });

        const vpc6cidr = Fn.select(0, this.vpcIpv6CidrBlocks);
        const subnet6cidrs = Fn.cidr(vpc6cidr, 256, (128 - 64).toString());

        let i = 0;
        for (const subnet of [
            ...this.publicSubnets,
            ...this.privateSubnets,
            ...this.isolatedSubnets,
        ]) {
            const cidr6 = Fn.select(i++, subnet6cidrs);

            // Find a CfnSubnet (raw cloudformation resources) child to the public subnet nodes.
            const cfnSubnet = valueOrDie<IConstruct, ec2.CfnSubnet>(
                subnet.node.children.find((c) => c instanceof ec2.CfnSubnet),
                new Error('Couldn\'t find a CfnSubnet'),
            );

            cfnSubnet.ipv6CidrBlock = cidr6;
            cfnSubnet.assignIpv6AddressOnCreation = true;
            if (props?.enableDnsSupport ?? true) {
                cfnSubnet.enableDns64 = true;
            }

            if (props?.ipv6Native && !this.publicSubnets.includes(subnet)) {
                cfnSubnet.ipv6Native = true;
                cfnSubnet.cidrBlock = undefined;
            }

            subnet.node.addDependency(ip6cidr);
        }

        for (const subnet of this.publicSubnets) {
            const s = subnet as ec2.PublicSubnet;
            const cfnRoute = valueOrDie<IConstruct, ec2.CfnRoute>(
                subnet.node.children.find((c) => {
                    return (
                        c instanceof ec2.CfnRoute && c.gatewayId !== undefined
                    );
                }),
                new Error('Cannot find public-internet route in public subnet'),
            );

            s.addRoute('DefaultRoute6', {
                routerType: ec2.RouterType.GATEWAY,
                routerId: cfnRoute.gatewayId!,
                destinationIpv6CidrBlock: '::/0',
                enablesInternetConnectivity: true,
            });
        }

        if (0 < this.privateSubnets.length) {
            const eigw = new ec2.CfnEgressOnlyInternetGateway(this, 'EIGW6', {
                vpcId: this.vpcId,
            });

            // Attach a routing table to the egress gateway for private subnets
            for (const subnet of this.privateSubnets) {
                const s = subnet as ec2.PrivateSubnet;
                s.node.addDependency(eigw);
                const cfnRoute = subnet.node.children.find((c) => {
                    return (
                        c instanceof ec2.CfnRoute &&
                        c.natGatewayId !== undefined
                    );
                }) as unknown as ec2.CfnRoute | undefined;

                if (cfnRoute !== undefined) {
                    s.addRoute('ipv6-to-4', {
                        routerType: ec2.RouterType.NAT_GATEWAY,
                        routerId: cfnRoute.natGatewayId!,
                        destinationIpv6CidrBlock: '64:ff9b::/96',
                        enablesInternetConnectivity: true,
                    });
                }

                s.addRoute('DefaultRoute6', {
                    routerType: ec2.RouterType.EGRESS_ONLY_INTERNET_GATEWAY,
                    routerId: eigw.ref,
                    destinationIpv6CidrBlock: '::/0',
                    enablesInternetConnectivity: true,
                });
            }
        }
    }
}
