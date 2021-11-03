import * as path from 'path';
import {
    aws_iam as iam,
    aws_lambda as lambda,
    aws_s3 as s3,
    custom_resources as cr,
    CustomResource, Stack,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as api from './s3-file-handler/api';
import { IBucket } from "aws-cdk-lib/aws-s3";

interface S3FileProps {
    /**
     * The bucket in which the file will be created.
     */
    readonly bucket: s3.IBucket;

    /**
     * The object key.
     *
     * @default - automatically-generated
     */
    readonly objectKey?: string;

    /**
     * The contents of the file.
     */
    readonly contents: string;

    /**
     * Indicates if this file should have public-read permissions.
     *
     * @default false
     */
    readonly public?: boolean;
}

export class S3File extends Construct {
    private readonly bucket: IBucket;
    public readonly objectKey: string;
    public readonly url: string;
    public readonly etag: string;

    constructor(scope: Construct, id: string, props: S3FileProps) {
        super(scope, id);

        const resource = new CustomResource(this, 'Resource', {
            serviceToken: S3FileProvider.getOrCreate(this),
            resourceType: 'Custom::S3File',
            properties: {
                [api.PROP_BUCKET_NAME]: props.bucket.bucketName,
                [api.PROP_CONTENTS]: props.contents,
                [api.PROP_OBJECT_KEY]: props.objectKey,
                [api.PROP_PUBLIC]: props.public,
            },
        });

        this.bucket = props.bucket;
        this.objectKey = resource.getAttString(api.ATTR_OBJECT_KEY);
        this.url = resource.getAttString(api.ATTR_URL);
        this.etag = resource.getAttString(api.ATTR_ETAG);
    }

    /**
     * (experimental) Grants read permissions to the principal on the assets bucket.
     *
     * @experimental
     */
    grantRead(grantee: iam.IGrantable): void {
        // we give permissions on all files in the bucket since we don't want to
        // accidentally revoke permission on old versions when deploying a new
        // version (for example, when using Lambda traffic shifting).
        this.bucket.grantRead(grantee);
    }
}

class S3FileProvider extends Construct {
    /**
     * Returns the singleton provider.
     */
    public static getOrCreate(scope: Construct) {
        const stack = Stack.of(scope);
        const id = 'com.amazonaws.cdk.custom-resources.s3file-provider';
        const x = stack.node.tryFindChild(id) as S3FileProvider || new S3FileProvider(stack, id);
        return x.provider.serviceToken;
    }

    private readonly provider: cr.Provider;

    constructor(scope: Construct, id: string) {
        super(scope, id);

        this.provider = new cr.Provider(this, 's3file-provider', {
            onEventHandler: new lambda.Function(this, 's3file-on-event', {
                code: lambda.Code.fromAsset(path.join(__dirname, 's3-file-handler')),
                runtime: lambda.Runtime.NODEJS_12_X,
                handler: 'index.onEvent',
                initialPolicy: [
                    new iam.PolicyStatement({
                        resources: ['*'],
                        actions: [
                            's3:GetObject*',
                            's3:GetBucket*',
                            's3:List*',
                            's3:DeleteObject*',
                            's3:PutObject*',
                            's3:Abort*',
                        ],
                    }),
                ],
            }),
        });
    }
}
