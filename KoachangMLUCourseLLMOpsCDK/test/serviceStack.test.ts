import { Template } from 'aws-cdk-lib/assertions';
import { BrazilFarmArtifacts, DeploymentEnvironmentFactory } from '@amzn/pipelines';
import { App } from 'aws-cdk-lib';
import { ServiceStack } from '../lib/serviceStack';
import { DataStack } from '../lib/dataStack';
import * as path from 'path';

describe('Data Stack', () => {
  beforeAll(() => {
    BrazilFarmArtifacts.fromPackage = jest.fn().mockReturnValue(path.join(__dirname, 'resources', 'fake-assets'));
    DataStack.prototype.getDataSetVersion = jest.fn().mockReturnValue('');
  });

  test("create expected data stack's resources", () => {
    const mockApp = new App();
    const env = DeploymentEnvironmentFactory.fromAccountAndRegion('test-account', 'us-west-2', 'unique-id');
    const dataStack = new DataStack(mockApp, 'DataStack', {
      env,
    });
    const serviceStack = new ServiceStack(mockApp, 'ServiceStack', {
      kendraIndex: dataStack.kendraIndex,
      isProd: true,
      env,
      stage: 'alpha',
    });
    const template = Template.fromStack(serviceStack);
    template.hasResource('AWS::Lambda::Function', {
      Properties: {
        FunctionName: 'KoachangMLUCourseLLMOps',
        Handler: 'koachang_mlu_course_llm_ops.lambda_handler',
        Runtime: 'python3.11',
        MemorySize: 512,
      },
    });
    template.hasResource('AWS::ApiGateway::RestApi', {});
    template.hasResource('AWS::ApiGateway::Stage', {
      Properties: {
        MethodSettings: [
          {
            DataTraceEnabled: false,
            HttpMethod: '*',
            MetricsEnabled: true,
            ResourcePath: '/*',
          },
        ],
        StageName: 'live',
        TracingEnabled: true,
      },
    });
  });
});
