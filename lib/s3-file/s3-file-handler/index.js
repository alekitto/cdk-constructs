/* eslint-disable no-console */
const AWS = require('aws-sdk');
const api = require('./api');

const s3 = new AWS.S3();

exports.onEvent = async function onEvent(event) {
    switch (event.RequestType) {
        case 'Create':
        case 'Update':
            return putObject(event);

        case 'Delete':
            return deleteObject(event);
    }
}

exports.putObject = putObject;
async function putObject(event) {
    const bucketName = event.ResourceProperties[api.PROP_BUCKET_NAME];
    if (!bucketName) { throw new Error('"BucketName" is required'); }

    const contents = event.ResourceProperties[api.PROP_CONTENTS];
    if (!contents) { throw new Error('"Contents" is required'); }

    // determine the object key which is the physical ID of the resource.
    // if it was not provided by the user, we generated it using the request ID.
    let objectKey = event.ResourceProperties[api.PROP_OBJECT_KEY] || event.LogicalResourceId + '-' + event.RequestId.replace(/-/g, '') + '.txt';

    // trim trailing `/`
    if (objectKey.startsWith('/')) {
        objectKey = objectKey.substr(1);
    }

    const publicRead = event.ResourceProperties[api.PROP_PUBLIC] || false;

    console.log(`writing s3://${bucketName}/${objectKey}`);

    const resp = await s3.putObject({
        Bucket: bucketName,
        Key: objectKey,
        Body: contents,
        ACL: publicRead ? 'public-read' : undefined,
    }).promise();

    // NOTE: updates to the object key will be handled automatically: a new object will be put and then we return
    // the new name. this will tell cloudformation that the resource has been replaced and it will issue a DELETE
    // for the old object.

    return {
        PhysicalResourceId: objectKey,
        Data: {
            [api.ATTR_OBJECT_KEY]: objectKey,
            [api.ATTR_ETAG]: resp.ETag,
            [api.ATTR_URL]: `https://${bucketName}.s3.amazonaws.com/${objectKey}`,
        },
    };
}

exports.deleteObject = deleteObject;
async function deleteObject(event) {
    const bucketName = event.ResourceProperties.BucketName;
    if (!bucketName) { throw new Error('"BucketName" is required'); }

    const objectKey = event.PhysicalResourceId;
    if (!objectKey) {
        throw new Error('PhysicalResourceId expected for DELETE events');
    }

    await s3.deleteObject({
        Bucket: bucketName,
        Key: objectKey,
    }).promise();
}
