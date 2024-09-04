import { Template } from 'aws-cdk-lib/assertions';
import { BrazilFarmArtifacts, DeploymentEnvironmentFactory } from '@amzn/pipelines';
import { App } from 'aws-cdk-lib';
import { DataStack } from '../lib/dataStack';
import * as path from 'path';

describe('Data Stack', () => {
  beforeAll(() => {
    BrazilFarmArtifacts.fromPackage = jest.fn().mockReturnValue(path.join(__dirname, 'resources', 'fake-assets'));
    DataStack.prototype.getDataSetVersion = jest.fn().mockReturnValue('');
  });

  test('is created with expected resources', () => {
    const mockApp = new App();
    const env = DeploymentEnvironmentFactory.fromAccountAndRegion('test-account', 'us-west-2', 'unique-id');
    const dataStack = new DataStack(mockApp, 'DataStack', {
      env,
    });
    const template = Template.fromStack(dataStack);

    // Contain Dataset Bucket
    template.hasResource('AWS::S3::Bucket', {
      Properties: {
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            {
              BucketKeyEnabled: true,
              ServerSideEncryptionByDefault: {
                SSEAlgorithm: 'aws:kms',
              },
            },
          ],
        },
        LoggingConfiguration: {
          LogFilePrefix: 'logs',
        },
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
        VersioningConfiguration: {
          Status: 'Enabled',
        },
      },
    });

    // Contain Kendra Index
    template.hasResource('AWS::Kendra::Index', {
      Properties: {
        Edition: 'DEVELOPER_EDITION',
        Name: 'KoachangMLUCourseLLMOpsIndex',
        ServerSideEncryptionConfiguration: {
          KmsKeyId: {},
        },
        UserContextPolicy: 'ATTRIBUTE_FILTER',
      },
    });
  });
});
