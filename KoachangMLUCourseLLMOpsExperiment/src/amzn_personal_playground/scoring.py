from rouge_score import rouge_scorer
from nltk.corpus import stopwords
from nltk.tokenize import word_tokenize


def cosine_similarity(text1: str, text2: str) -> float:
    text1_words = set(word_tokenize(text1))
    text2_words = set(word_tokenize(text2))

    sw = stopwords.words("english")
    text1_words = {w for w in text1_words if not w in sw}
    text2_words = {w for w in text2_words if not w in sw}

    vector = text1_words.union(text2_words)
    l1 = [int(w in text1_words) for w in vector]
    l2 = [int(w in text2_words) for w in vector]
    c = 0
    for i in range(len(vector)):
        c += l1[i] * l2[i]
    return c / float((sum(l1) * sum(l2)) ** 0.5)


def rouge_score(model: str, text1: str, text2: str) -> float:
    scorer = rouge_scorer.RougeScorer([model], use_stemmer=True)
    scores = scorer.score(text1, text2)
    return scores[model].fmeasure
