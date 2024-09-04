import boto3
import os
import requests

from requests_auth_aws_sigv4 import AWSSigV4
from typing import Any

from flock_eval.evaluation import AbstractEvaluator
from flock_eval.similarity.base import EvaluationMetric
from flock_eval.similarity.config import MetricDefinitions
from flock_eval.testsuite import RetryStrategy
from flock_eval.testsuite.rating_suite import TextRatingSuite
from flock_eval.testsuite.testcase import Solution, TextTestCase

from koachang_mlu_course_llm_ops_tests.test_invoke_function import (
    REGION,
    _api_endpoint,
)


class InvokeFunctionEvaluator(AbstractEvaluator):

    def __init__(self, metrics: MetricDefinitions, retry_strategy: RetryStrategy = None) -> None:
        super().__init__(metrics, retry_strategy)

        self.region = os.environ.get("AWS_REGION", "us-west-2")
        self.api_endpoint = _api_endpoint(boto3.client("cloudformation", region_name=self.region))

    @property
    def test_case_class(self):
        return TextTestCase

    @property
    def rating_suite(self):
        return TextRatingSuite

    def generate_system_solution(self, question: Any) -> Solution:
        response = requests.post(
            self.api_endpoint,
            json={"question": question},
            auth=AWSSigV4("execute-api", region=self.region),
        )
        if response.status_code == 200 and "answer" in response.json():
            return Solution(response=response.json()["answer"])
        else:
            raise ValueError(
                f"Service failed to return valid response. Original response: {response}"
            )
