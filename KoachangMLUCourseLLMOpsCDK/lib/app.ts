#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { DependencyModel, DeploymentPipeline, Platform } from '@amzn/pipelines';
import { BrazilPackage } from '@amzn/pipelines';
import { ServiceStack } from './serviceStack';
import { MonitoringStack } from './monitoringStack';
import { DataStack } from './dataStack';

// Set up your CDK App
const app = new App();

const applicationAccount = '961341554577';

const pipeline = new DeploymentPipeline(app, 'Pipeline', {
  account: applicationAccount,
  pipelineName: 'KoachangMLUCourseLLMOps',
  versionSet: {
    name: 'KoachangMLUCourseLLMOps/development', // The version set you created
    dependencyModel: DependencyModel.PERU,
  },
  versionSetPlatform: Platform.AL2_X86_64,
  trackingVersionSet: 'Linux/central', // Or any other version set you prefer
  bindleGuid: 'amzn1.bindle.resource.35vyrnwvnohvsigehx2upt4da',
  description: 'Simple CDK Pipeline',
  pipelineId: '6921224',
  notificationEmailAddress: 'koachang@amazon.com',
  selfMutate: true,
});

[
  'KoachangMLUCourseLLMOps',
  'KoachangMLUCourseLLMOpsTests',
  'KoachangMLUCourseLLMOpsExperiment',
  'KoachangMLUCourseLLMOpsData',
].forEach((pkg) => pipeline.addPackageToAutobuild(BrazilPackage.fromString(pkg)));

const stageName = 'alpha';
const alphaStage = pipeline.addStage(stageName, { isProd: false });
const deploymentGroup = alphaStage.addDeploymentGroup({
  name: 'alphaApplication',
});

const env = pipeline.deploymentEnvironmentFor('961341554577', 'us-west-2');

const dataStack = new DataStack(app, `KoachangMLUCourseLLMOps-Data-${stageName}`, {
  env,
});

const serviceStack = new ServiceStack(app, `KoachangMLUCourseLLMOps-Service-${stageName}`, {
  env,
  stage: 'alpha',
  isProd: false,
  enableGradualDeployment: false,
  kendraIndex: dataStack.kendraIndex,
});

const monitoringStack = new MonitoringStack(app, `KoachangMLUCourseLLMOps-Monitoring-${stageName}`, {
  env,
  lambdaFunction: serviceStack.lambdaFunction,
  restApi: serviceStack.restApi,
  kendraIndex: dataStack.kendraIndex,
});
deploymentGroup.addStacks(dataStack, serviceStack, monitoringStack);

const integTestApprovalStep = serviceStack.createIntegrationTestsApprovalWorkflowStep(
  'Integration Test',
  Platform.AL2_X86_64,
);

alphaStage.addApprovalWorkflow('Hydra Tests', {
  sequence: [integTestApprovalStep],
  requiresConsistentRevisions: true,
});
