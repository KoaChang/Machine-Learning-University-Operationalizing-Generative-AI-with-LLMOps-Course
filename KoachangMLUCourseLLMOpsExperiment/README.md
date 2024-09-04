# KoachangMLUCourseLLMOpsExperiment

This package contains a notebook with utility code to experiment with Bedrock's model.
The package pulls example datasets for RAG and fine-tuning from the `KoachangMLUCourseLLMOpsData` package.

## Using the notebook

1. [Obtain your access to the Bedrock models](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html) via AWS console.
2. Have your temporary credentials ready at `bedrock` profile. You can change the profile name from the notebook. Example command:
```
ada cred update --profile bedrock --account <YourAccount> --role Admin
```
3. Build this package once with `brazil-build release`.
4. The notebook can be opened using Visual Studio Code, which natively supports
Jupyter Notebooks. Once opened, make sure you use the Python environment that's installed by PeruPython,
which  is usually located at `.venv` directory of this package. To select an environment, use the
`Python: Select Interpreter` command from the Command Palette (⇧⌘P or Ctrl+Shift+P).

### Personal playground

The notebook provides examples of prompt engineering. It demonstrates interacting with Bedrock using both the AWS SDK and
LangChain. It shows basic usage of RAG with Cohere Embed as the embedding model, ChromaDB as the local vector store library,
and Claude as the LLM. When moving to production, using a managed service like Kendra to manage the RAG workflow is recommended.

### Evaluation

The evaluation section demonstrates how we assess the Claude Instant, Jurassic Mid, and Amazon Titan Express models on
text summarization capabilities. The [cnn_dailymail](https://huggingface.co/datasets/cnn_dailymail) dataset is used
as an example, however it can be swapped out to a custom datasets by loading alternative data into the
`articles` and `ground_truths` arrays.

For each model, the responses are compared against the ground truth to produce ROUGE-L scores and cosine similarity metrics.
We use Claude-as-a-judge to rate the accuracy, coherence, factuality, and completeness of the summaries.

### Notes

**Auto-complete in vscode's notebooks**

If you use vscode, in order to have auto-complete in the notebooks, set the `python.languageServer` configuration
to `Pylance`.

## Update dependencies
It is recommended to test and update your dependencies in the Python virtual environment created with `brazil-build`. 
You should have previously run `brazil-build release`, and the virtual environment should exist under `./.venv`. If not,
you can run following steps:
1. Run `brazil-build`. This will create a Python virtual environment with Peru repository configured.
2. Run `source .venv/bin/activate` to use the virtual environment.

Now you can use `pip install` to install or update dependencies. You can use 
[Peruse](https://prod.peruse.builder-tools.aws.dev/search) to search dependency versions available in Peru. Once 
installed, you can use it in the Jupyter notebook. 

Once you've tested the dependencies, you can update the changes by editing `pyproject.toml` file:
```
[project.optional-dependencies]
dev = [
    ... # Update dependencies
]
```

After editing the file, you should refresh the dependency lock file `requirements.txt`. You can do so by using 
`pip-compile` command. Note that you should run the commands from the Python virtual environment.
1. Run `source .venv/bin/activate` to use the virtual environment.
2. Install `pip-compile`: `pip install pip-tools`
3. Run `pip-compile --extra=dev --no-emit-index-url --no-emit-trusted-host -o requirements.txt pyproject.toml`.
This will update the `requirements.txt` with latest dependencies. You can view the updates with 
`git diff requirements.txt`.
4. Now run `brazil-build` or `pip install -e .[dev] -r requirements.txt` install the updated dependencies, and then run
your Jupyter notebook.