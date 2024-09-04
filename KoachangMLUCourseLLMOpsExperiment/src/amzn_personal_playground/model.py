from enum import Enum


class Model(Enum):
    AI21_JURASSIC_MID = "ai21.j2-mid-v1"
    AI21_JURASSIC_ULTRA = "ai21.j2-ultra-v1"
    AMAZON_TITAN_TEXT_LITE = "amazon.titan-text-lite-v1"
    AMAZON_TITAN_TEXT_EXPRESS = "amazon.titan-text-express-v1"
    AMAZON_TITAN_TEXT_AGILE = "amazon.titan-text-agile-v1"
    AMAZON_TITAN_EMBED_TEXT = "amazon.titan-embed-text-v1"
    ANTHROPIC_CLAUDE_2 = "anthropic.claude-v2"
    ANTHROPIC_CLAUDE_INSTANT = "anthropic.claude-instant-v1"
    ANTHROPIC_CLAUDE_3_HAIKU = "anthropic.claude-3-haiku-20240307-v1:0"
    ANTHROPIC_CLAUDE_3_SONNET = "anthropic.claude-3-sonnet-20240229-v1:0"
    COHERE_COMMAND = "cohere.command-text-v14"
    COHERE_COMMAND_LIGHT = "cohere.command-light-text-v14"
    COHERE_EMBED_ENGLISH = "cohere.embed-english-v3"
    COHERE_EMBED_MULTILINGUAL = "cohere.embed-multilingual-v3"
    META_LLAMA2 = "meta.llama2-13b-chat-v1"
