## KoachangMLUCourseLLMOps

** Describe KoachangMLUCourseLLMOps here **

This package is a Python Lambda package to use with CDK Pipeline. It doesn't have an API Gateway
definition associated with it. It's most useful when you just want to deploy a lambda function,
perhaps for use as a stream consumer, or invoked by SQS, SNS, or CloudWatch.

In addition to usual Python code and configuration files, this package contains BATS CloudFormation
publisher configuations at `configuration/Packaging/CloudFormation.yml`. BATS requires these
configurations to know how to publish your Lambda zip package. If you are not familiar with BATS, read more
about [BATS CloudFormation publisher](https://builderhub.corp.amazon.com/docs/bats/user-guide/publishers-cloudformation.html).

This package does not contain any deployment logic, they are defined in CDK Package.

## Integrating with existing CDK package

If your CDK package does not have any stages or stacks yet, follow [our guides](https://builderhub.corp.amazon.com/docs/native-aws/developer-guide/cdk-pipeline.html#application-stacks)
to add them to your setup.

Once you have your stack ready, add the sample Lambda function using this snippet:

```
  new lambda.Function(this, 'KoachangMLUCourseLLMOpsHelloWorldService', {
    code: LambdaAsset.fromBrazil({
      brazilPackage: BrazilPackage.fromString('KoachangMLUCourseLLMOps-1.0'),
      componentName: 'HelloWorldService',
    }),
    handler: 'basic_llm_service.lambda_handler',
    memorySize: 128,
    timeout: cdk.Duration.seconds(30),
    runtime: lambda.Runtime.PYTHON_3_11
  });
```

## General Workflow

For testing with this Lambda package, here's our current recommendation:

1. Unit tests. Run good old fashioned unit tests against your code.
1. Deploy to your personal stack and validate the functionalities there. This needs to be done in two steps:
   1. Run `brazil-build` in this package.
   1. Run `brazil-build run cdk deploy --hotswap $StackName` in your CDK package.
1. CR and Push. Run integration tests in your pipeline for your function.
