## Overview

This package will help you manage Pipelines and your AWS Infrastructure with the power of CDK! This
sample application is an example GenAI application backed by Lambda, Bedrock, Kendra, and other
AWS services.

You can view this package's pipeline on [Amazon Pipelines UI](https://pipelines.amazon.com/pipelines/KoachangMLUCourseLLMOps).

## Development

```bash
brazil ws create --name KoachangMLUCourseLLMOps
cd KoachangMLUCourseLLMOps
brazil ws use \
  --versionset KoachangMLUCourseLLMOps/development \
  --platform AL2_x86_64 \
  --package KoachangMLUCourseLLMOpsCDK
cd src/KoachangMLUCourseLLMOpsCDK
brazil-build
```

## Testing your alpha endpoint

This application deploys a Lambda-backed service running behind an API Gateway. To invoke this API,
first retrieve its endpoint URL:

```
ada cred update --account 961341554577 --role Admin --once

aws cloudformation describe-stacks \
  --region us-west-2 \
  --stack-name KoachangMLUCourseLLMOps-Service-alpha \
  --query 'Stacks[0].Outputs[?ExportName==`KoachangMLUCourseLLMOps-ApiUrl`].OutputValue' \
  --output text | cat
```

Then change to the package `KoachangMLUCourseLLMOps`, build it and invoke the API:

```
cd <YourWorkspace>/src/KoachangMLUCourseLLMOps

brazil-build release

.venv/bin/awscurl <YourEndpointUrl> \
  --region us-west-2 \
  --service execute-api \
  -X POST \
  -d '{"question": "Maximum size of ephemeral storage allowed by Lambda?"}'
```

## Useful links:

- https://builderhub.corp.amazon.com/docs/native-aws/developer-guide/cdk-pipeline.html
- https://code.amazon.com/packages/PipelinesConstructs/blobs/mainline/--/README.md
- https://code.amazon.com/packages/AmznCdkCli/blobs/HEAD/--/README.md
- https://docs.aws.amazon.com/cdk/api/latest/versions.html
