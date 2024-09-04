## Overview

This package contains the integration tests for Lambda application. Out of the box, the tests
can be executed via Hydra or from local machine.

## Running tests via Hydra

If this package was created via BuilderHub Create, Hydra resources and configurations should be
created automatically for you in CDK packages. To run the tests via Hydra, simply
push your change and let Pipelines trigger them via Hydra.

If you want to wire up Hydra configurations yourself, check out the
[official Hydra guide](https://builderhub.corp.amazon.com/docs/hydra/user-guide/getting-started.html)
and use this run definition:

```
  {
    "SchemaVersion": "1.0",
    "SchemaType": "HydraCustom",
    "HydraParameters": {
      "Runtime": "python3.12",
      "Handler": "hydra_test_platform_pytest.lambda_handler.handler",
      "ComputeEngine": "Lambda",
    },
    "HandlerParameters": {
      "PythonTestPackage": "koachang_mlu_course_llm_ops_tests"
    }
  }
```

## Running tests from local machine

### Prerequisites

The tests requires AWS credentials that have, at least, the same permissions as
your Hydra invocation role. You need to make sure your credentials are available
in your environment. One option is to use [ADA](https://w.amazon.com/bin/view/DevAccount/Docs).

Read more on how credentials are retrieved [here](https://boto3.amazonaws.com/v1/documentation/api/latest/guide/credentials.html).


### Running tests against alpha stage

1. If you have not built the package before, you need to run `brazil-build` first, which will create a virtual Python environment. After `brazil-build`, run `source ./.venv/bin/activate` to activate the virtual environment. 
1. Use ADA to acquire a credential locally, and the credential should have permission to invoke your API.
1. Run below command to start the integration tests (**change AWS_REGION if you are not using us-west-2**)
    ```bash
    AWS_REGION=us-west-2 pytest src
    ```

## Running Flock regression test from local machine
We can use FlockEval CLI to run evaluation in batch locally. We use a custom evaluator to invoke the API gateway 
endpoint, and Flock will compare the output with ground truth on multiple metrics. 
 
See all metric definitions: https://code.amazon.com/packages/FlockEval/blobs/mainline/--/doc/evaluation.md
 
1. If you have not built the package before, you need to run `brazil-build` first, which will create a virtual Python 
environment. After `brazil-build`, run `source ./.venv/bin/activate` to activate the virtual environment. 
1. Use ADA to acquire a credential locally, and the credential should have permission to invoke your API.
1. Run Flock CLI like below:
    ```bash
    flock-eval-cli \
    -d configuration/data/flock-dataset.jsonl \
    --no-metric-meteor \
    --custom-evaluator koachang_mlu_course_llm_ops_tests.flock_custom_evaluator:InvokeFunctionEvaluator
    ```
Note that we need to disable meteor metric type which currently has a bug: https://t.corp.amazon.com/P13979209 