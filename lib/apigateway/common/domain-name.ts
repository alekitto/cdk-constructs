import { IResource, Resource, Token, aws_certificatemanager as acm, aws_apigatewayv2 as apigatewayv2 } from 'aws-cdk-lib';
import { Construct } from 'constructs';

/**
 * Represents an APIGatewayV2 DomainName
 * @see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-apigatewayv2-domainname.html
 */
export interface IDomainName extends IResource {
    /**
     * The custom domain name
     * @attribute
     */
    readonly name: string;

    /**
     * The domain name associated with the regional endpoint for this custom domain name.
     * @attribute
     */
    readonly regionalDomainName: string;

    /**
     * The region-specific Amazon Route 53 Hosted Zone ID of the regional endpoint.
     * @attribute
     */
    readonly regionalHostedZoneId: string;
}

/**
 * Custom domain name attributes
 */
export interface DomainNameAttributes {
    /**
     * Domain name string
     */
    readonly name: string;

    /**
     * The domain name associated with the regional endpoint for this custom domain name.
     */
    readonly regionalDomainName: string;

    /**
     * The region-specific Amazon Route 53 Hosted Zone ID of the regional endpoint.
     */
    readonly regionalHostedZoneId: string;
}

/**
 * Properties used for creating the DomainName
 */
export interface DomainNameProps {
    /**
     * The custom domain name
     */
    readonly domainName: string;
    /**
     * The ACM certificate for this domain name
     */
    readonly certificate: acm.ICertificate;
}

/**
 * Custom domain resource for the API
 */
export class DomainName extends Resource implements IDomainName {
    /**
     * Import from attributes
     */
    public static fromDomainNameAttributes(scope: Construct, id: string, attrs: DomainNameAttributes): IDomainName {
        class Import extends Resource implements IDomainName {
            public readonly regionalDomainName = attrs.regionalDomainName;
            public readonly regionalHostedZoneId = attrs.regionalHostedZoneId;
            public readonly name = attrs.name;
        }
        return new Import(scope, id);
    }

    public readonly name: string;
    public readonly regionalDomainName: string;
    public readonly regionalHostedZoneId: string;

    constructor(scope: Construct, id: string, props: DomainNameProps) {
        super(scope, id);

        if ('' === props.domainName) {
            throw new Error('empty string for domainName not allowed');
        }

        const domainNameProps: apigatewayv2.CfnDomainNameProps = {
            domainName: props.domainName,
            domainNameConfigurations: [
                {
                    certificateArn: props.certificate.certificateArn,
                    endpointType: 'REGIONAL',
                },
            ],
        };
        const resource = new apigatewayv2.CfnDomainName(this, 'Resource', domainNameProps);
        this.name = resource.ref;
        this.regionalDomainName = Token.asString(resource.getAtt('RegionalDomainName'));
        this.regionalHostedZoneId = Token.asString(resource.getAtt('RegionalHostedZoneId'));
    }
}
