import os
import json
import pytest

from http import HTTPStatus
from unittest.mock import call, patch, Mock

import botocore

from koachang_mlu_course_llm_ops import lambda_handler


@pytest.fixture
def mock_get_chain():
    with patch("koachang_mlu_course_llm_ops.handler.get_chain") as mock_get_chain:
        yield mock_get_chain


@pytest.fixture
def mock_prompt():
    with patch("koachang_mlu_course_llm_ops.handler.prompt_enforce") as mock_prompt:
        yield mock_prompt


@pytest.fixture
def mock_retrieve_context():
    with patch("koachang_mlu_course_llm_ops.handler.retrieve_context") as mock_retrieve_context:
        yield mock_retrieve_context


@pytest.fixture
def mock_llm():
    with patch("koachang_mlu_course_llm_ops.handler.llm_claude_haiku") as mock_llm:
        yield mock_llm


@pytest.fixture
def mock_event():
    yield {
        "resource": "/",
        "path": "/",
        "httpMethod": "POST",
        "multiValueHeaders": {"Content-Type": ["application/json"]},
        "multiValueQueryStringParameters": None,
        "pathParameters": None,
        "stageVariables": None,
        "requestContext": {
            "accountId": "12345678912",
            "apiId": "fake_api_id",
            "httpMethod": "POST",
            "identity": {
                "accessKey": "fake_access_key",
                "accountId": "fake_account_id",
                "caller": "fake_caller",
                "user": "fake_user",
                "userAgent": "fake_agent",
                "userArn": "arn:aws:sts::12345678912:assumed-role/BONESBootstrapHydra-MyTestLambda/CODETEST_MyTestLambda_0678761137",
                "sourceIp": "0.0.0.0",
            },
            "path": "/",
            "requestId": "fake_request_id",
            "resourceId": "fake_resource_id",
            "resourcePath": "/",
            "stage": "default",
        },
        "body": "",
        "isBase64Encoded": False,
    }


@pytest.fixture
def mock_aws():
    with patch("botocore.client.BaseClient._make_api_call") as mock_aws_api:
        yield mock_aws_api

def test_lambda_handler_returning_correct_format(
        mock_retrieve_context, mock_get_chain, mock_event
    ):
    mock_event["body"] = '{"question": "fake question"}'
    mock_get_chain.return_value.invoke.return_value = "fake_answer"
    mock_retrieve_context.return_value = {
        "question": "fake question",
        "context": "Context Foo\nContext Bar",
        "document_ids": [
            "s3://fake-bucket/rag/lambda-developer-guide-231030/foo.md",
            "s3://fake-bucket/rag/blogs/bar.md"
            ]
        }

    response = lambda_handler(mock_event, None)

    assert response.get("statusCode") == HTTPStatus.OK
    assert json.loads(response.get("body")).get("answer") == "fake_answer"
    assert set(json.loads(response.get("body")).get("relevant_links")) == set([
        "https://docs.aws.amazon.com/lambda/latest/dg/foo.html",
        "https://aws.amazon.com/blogs/compute/bar/"
    ])
    

def test_chain_receiving_contexts(mock_aws, mock_prompt, mock_llm, mock_event):
    mock_event["body"] = '{"question": "fake question"}'

    mock_aws.side_effect = [
        # The first AWS API call is to check the input against Bedrock Guardrail
        {
            "action": "NONE",
        },
        # The second AWS API call is to retrieve contexts from Kendra
        {
            "ResultItems": [
                {"Content": "Content Foo", "DocumentId": "s3://fake-bucket/rag/lambda-developer-guide-231030/foo.md"},
                {"Content": "Content Bar", "DocumentId": "s3://fake-bucket/rag/blogs/bar.md"},
            ],
        },
        # The third AWS API call is to check the output against Bedrock Guardrail
        {
            "action": "NONE",
        },
        # The fourth AWS API call is to retrieve contexts from Kendra
        {
            "ResultItems": [
                {"Content": "Content Foo", "DocumentId": "s3://fake-bucket/rag/lambda-developer-guide-231030/foo.md"},
                {"Content": "Content Bar", "DocumentId": "s3://fake-bucket/rag/blogs/bar.md"},
            ],
        },
    ]

    mock_llm.return_value = "<answer>fake-answer</answer>"

    lambda_handler(mock_event, None)

    assert mock_aws.call_args_list == [
        call(
            "ApplyGuardrail",
            {
                "guardrailIdentifier": "fake-guardrail-id",
                "guardrailVersion": "fake-guardrail-version",
                "source": "INPUT",
                "content": [{"text": {"text": "fake question", "qualifiers": ["guard_content"]}}],
            },
        ),
        call(
            "Retrieve",
            {
                "IndexId": "fake-kendra-index-id-lorem-ipsum-dolor-sit-amet",
                "QueryText": "fake question",
                "PageNumber": 1,
                "PageSize": 5,
            },
        ),
        call(
            "ApplyGuardrail",
            {
                "guardrailIdentifier": "fake-guardrail-id",
                "guardrailVersion": "fake-guardrail-version",
                "source": "INPUT",
                "content": [{"text": {"text": "fake-answer", "qualifiers": ["guard_content"]}}],
            },
        ),
        call(
            "Retrieve",
            {
                "IndexId": "fake-kendra-index-id-lorem-ipsum-dolor-sit-amet",
                "QueryText": "fake question",
                "PageNumber": 1,
                "PageSize": 5,
            },
        ),
    ]

    assert mock_prompt.call_args_list == [
        call({
            "question": "fake question",
            "context": "Content Foo\nContent Bar",
            "document_ids": [
                "s3://fake-bucket/rag/lambda-developer-guide-231030/foo.md",
                "s3://fake-bucket/rag/blogs/bar.md"
            ]})
    ] 
    
def test_guardrailed_output(mock_aws, mock_event, mock_llm):
    mock_event["body"] = '{"question": "fake question"}'

    mock_aws.side_effect = [
        # The first AWS API call is to check the input against Bedrock Guardrail
        {
            "action": "NONE",
        },
        # The second AWS API call is to retrieve contexts from Kendra
        {
            "ResultItems": [
                {"Content": "Content Foo", "DocumentId": "s3://fake-bucket/rag/lambda-developer-guide-231030/foo.md"},
                {"Content": "Content Bar", "DocumentId": "s3://fake-bucket/rag/blogs/bar.md"},
            ],
        },
        # The third AWS API call is to check the output against Bedrock Guardrail
        {
            "action": "GUARDRAIL_INTERVENED",
            "ResponseMetadata": {"RequestId": "mock-request-id"},
        },
    ]
    mock_llm.return_value = "<answer>fake-answer</answer>"

    response = lambda_handler(mock_event, None)

    assert response.get("statusCode") == HTTPStatus.BAD_REQUEST
    assert (
        json.loads(response.get("body")).get("message") == "Content was blocked by guardrail"
    )

def test_guardrailed_question(mock_aws, mock_event, mock_retrieve_context):
    mock_event["body"] = '{"question": "fake question"}'

    mock_aws.return_value = {
        "action": "GUARDRAIL_INTERVENED",
        "ResponseMetadata": {"RequestId": "mock-request-id"},
    }

    response = lambda_handler(mock_event, None)

    assert not mock_retrieve_context.called
    assert response.get("statusCode") == HTTPStatus.BAD_REQUEST
    assert (
        json.loads(response.get("body")).get("message") == "Content was blocked by guardrail"
    )
