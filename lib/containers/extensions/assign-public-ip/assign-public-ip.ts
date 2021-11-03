import {
    aws_ec2 as ec2,
    aws_ecs as ecs,
    aws_route53 as route53,
} from 'aws-cdk-lib';
import { Service } from '../../service';
import { Container } from '../container';
import { ServiceExtension, ServiceBuild, EnvironmentCapacityType } from '../extension-interfaces';
import { TaskRecordManager } from './task-record-manager';
import { Construct } from "constructs";

export interface AssignPublicIpExtensionOptions {
    /**
     * Enable publishing task public IPs to a recordset in a Route 53 hosted zone.
     *
     * Note: If you want to change the DNS zone or record name, you will need to
     * remove this extension completely and then re-add it.
     */
    dns?: AssignPublicIpDnsOptions;
}

export interface AssignPublicIpDnsOptions {
    /**
     * A DNS Zone to expose task IPs in.
     */
    zone: route53.IHostedZone;

    /**
     * Name of the record to add to the zone and in which to add the task IP
     * addresses to.
     *
     * @example 'myservice'
     */
    recordName: string;
}

/**
 * Modifies the service to assign a public ip to each task and optionally
 * exposes public IPs in a Route 53 record set.
 *
 * Note: If you want to change the DNS zone or record name, you will need to
 * remove this extension completely and then re-add it.
 */
export class AssignPublicIpExtension extends ServiceExtension {
    dns?: AssignPublicIpDnsOptions;

    constructor(options?: AssignPublicIpExtensionOptions) {
        super('public-ip');

        this.dns = options?.dns;
    }

    private hasDns() {
        return Boolean(this.dns);
    }

    public prehook(service: Service, _scope: Construct) {
        super.prehook(service, _scope);

        if (service.capacityType != EnvironmentCapacityType.FARGATE) {
            throw new Error('AssignPublicIp only supports Fargate tasks');
        }
    }

    public modifyServiceProps(props: ServiceBuild): ServiceBuild {
        return {
            ...props,
            assignPublicIp: true,
        } as ServiceBuild;
    }

    public useService(service: ecs.Ec2Service | ecs.FargateService) {
        if (this.hasDns()) {
            new TaskRecordManager(service, 'TaskRecordManager', {
                service: service,
                dnsZone: this.dns!.zone,
                dnsRecordName: this.dns!.recordName,
            });

            const container = this.parentService.serviceDescription.get('service-container') as Container;
            for (const trafficPort of container.trafficPorts) {
                const port = (trafficPort.protocol ?? ecs.Protocol.TCP) === ecs.Protocol.TCP ? ec2.Port.tcp(trafficPort.port) : ec2.Port.udp(trafficPort.port);
                service.connections.allowFromAnyIpv4(port, 'Accept inbound traffic on traffic port from anywhere');
            }
        }
    }
}
