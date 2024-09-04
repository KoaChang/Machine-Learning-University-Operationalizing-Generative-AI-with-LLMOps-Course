import os

import re
from typing import Optional
import boto3
from aws_lambda_powertools import Logger, Metrics
from aws_lambda_powertools.event_handler import APIGatewayRestResolver
from aws_lambda_powertools.event_handler.exceptions import BadRequestError
from aws_lambda_powertools.utilities.typing import LambdaContext
from langchain_aws import ChatBedrock
from langchain_community.callbacks.manager import get_bedrock_anthropic_callback
from langchain.output_parsers.regex import RegexParser
from langchain_core.prompts import PromptTemplate
from langchain.tools import tool


app = APIGatewayRestResolver()
logger = Logger(service="KoachangMLUCourseLLMOps")
metrics = Metrics(namespace="KoachangMLUCourseLLMOps", service="ApiHandler")

KENDRA_INDEX_ID = os.environ["KENDRA_INDEX_ID"]
GUARDRAIL_ID = os.environ["GUARDRAIL_ID"]
GUARDRAIL_VERSION = os.environ["GUARDRAIL_VERSION"]
AWS_REGION = os.environ["AWS_REGION"]

kendra = boto3.client("kendra", region_name=AWS_REGION)
bedrock_runtime = boto3.client("bedrock-runtime", region_name=AWS_REGION)
llm_claude_haiku = ChatBedrock(
    model_id="anthropic.claude-3-haiku-20240307-v1:0",
    client=bedrock_runtime,
    model_kwargs={
        "max_tokens": 500,
        "temperature": 0.0,
        "top_k": 10,
        "top_p": 1.0,
    },
    cache=False,
)

prompt_enforce = PromptTemplate.from_template(
    """You act as a AWS Cloud Practitioner and only answer questions about AWS. Read the user's
question supplied within the <question></question> tags. Then, use the contextual information provided
above within the <context></context> tags to provide an answer. Do not repeat the context.
Respond that you don't know if you don't have enough information to answer.

Return your output in <answer></answer> tags as in this example:

<context>
Example context
</context>

<question>
Example question
</question>

<answer>
Example answer
</answer>

Below starts the real task:

<context>
{context}
</context>

<question>
{question}
</question>
""")

parser = RegexParser(regex=r"(?s)<answer>(.*)</answer>", output_keys=["answer"])


@tool(infer_schema=False)
def guardrail(content: str) -> str:
    """Guard the content with Bedrock Guardrail. If the content is not flagged by Guardrail,
    forward it to the next tool in chain.
    """
    result = bedrock_runtime.apply_guardrail(
        guardrailIdentifier=GUARDRAIL_ID,
        guardrailVersion=GUARDRAIL_VERSION,
        source="INPUT",
        content=[
            {
                "text": {
                    "text": content,
                    "qualifiers": [
                        "guard_content",
                    ],
                }
            },
        ],
    )
    if result["action"] != "NONE":
        logger.warning(f"Guardrail ({GUARDRAIL_ID}) intervened ({result['ResponseMetadata']['RequestId']})")
        raise BadRequestError("Content was blocked by guardrail")

    return content

@tool
def retrieve_context(query: str) -> dict:
    """Retrieve the list of documents from Kendra that are relevant to the query"""
    response = kendra.retrieve(
        IndexId=KENDRA_INDEX_ID,
        QueryText=query,
        PageNumber=1,
        PageSize=5,
    )
    documents = response["ResultItems"]
    document_ids = [document["DocumentId"] for document in documents]
    context = "\n".join([document["Content"] for document in documents])
    return {
        "question": query,
        "context": context,
        "document_ids": document_ids,
    }


# Function to return a link mapping the retrieved document to its URL
def get_link_from_document_id(document_id: str) -> Optional[str]:
    if match := re.search("s3://.*?/rag/lambda-developer-guide-231030/(.*).md$", document_id):
        path = match.group(1)
        return f"https://docs.aws.amazon.com/lambda/latest/dg/{path}.html"

    if match := re.search("s3://.*?/rag/sagemaker-developer-guide/(.*).md$", document_id):
        path = match.group(1)
        return f"https://docs.aws.amazon.com/sagemaker/latest/dg/{path}.html"

    if match := re.search("s3://.*?/rag/blogs/(.*).md$", document_id):
        path = match.group(1)
        return f"https://aws.amazon.com/blogs/compute/{path}/"
    
def get_chain():
    return guardrail | retrieve_context | prompt_enforce | llm_claude_haiku | parser | guardrail

@app.post("/")
def query_handler() -> str:
    post_data: dict = app.current_event.json_body
    question = post_data.get("question")
    if not question:
        raise BadRequestError("Request must contain 'question' field")

    with get_bedrock_anthropic_callback() as cb:
        answer = get_chain().invoke(question)
        metrics.add_metric(name="InputTokens", unit="Count", value=cb.prompt_tokens)
        metrics.add_metric(name="OutputTokens", unit="Count", value=cb.completion_tokens)
        metrics.add_metric(name="TotalTokens", unit="Count", value=cb.total_tokens)

    document_ids = retrieve_context(question)["document_ids"]
    relevant_links = set([get_link_from_document_id(doc_id) for doc_id in document_ids]) 

    return {"answer": answer.strip(), "relevant_links": list(relevant_links)}

@metrics.log_metrics
def lambda_handler(event: dict, context: LambdaContext) -> dict:
    return app.resolve(event, context)
