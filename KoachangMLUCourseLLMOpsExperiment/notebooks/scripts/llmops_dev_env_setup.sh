#! /bin/bash
if [ -z "${Alias}" ]
then
    echo "\$var is empty"
    if [ "$#" -ne 1 ]; then
     echo "Usage: $0  your_alias (first character as capital)"
  	exit
	fi
fi

# Create a new workspace on your CloudDesktop
Alias=$(echo $USER | sed 's/[^ _-]*/\u&/g')
brazil workspace create --name ws_${Alias}MLUCourseLLMOps
cd ws_${Alias}MLUCourseLLMOps

# Tell your workspace to use the Python and Node versions that you've installed earlier
$HOME/.local/bin/mise use python@3.12
$HOME/.local/bin/mise use node@18

# Validate that those tools are ready:
# 	This command should return a path to the python binary under a mise-managed dir
# 	Example: ~/.local/share/mise/installs/python/3.12/bin/python
which python

# 	This command should return a path to the node binary under a mise-managed dir
# 	Example: ~/.local/share/mise/installs/node/18/bin/node
which node

# 	This command should return a path to the npm binary under a mise-managed dir
# 	Example: ~/.local/share/mise/installs/node/18/bin/npm
which npm

# Pull all the relevant packages to the workspace 
brazil ws use --vs Linux/central
brazil ws use --package ${Alias}MLUCourseLLMOpsCDK \
    --package ${Alias}MLUCourseLLMOpsData \
    --package ${Alias}MLUCourseLLMOpsExperiment \
    --package ${Alias}MLUCourseLLMOps \
    --package ${Alias}MLUCourseLLMOpsTests

# Bring the notebooks containing the course labs into your Experiments package:
cd $(brazil-context workspace root)/src/${Alias}MLUCourseLLMOpsExperiment
curl -c ~/.midway/cookie -b ~/.midway/cookie https://portal.mlu.aws.dev/courses/documents/MLU-LLMOPS-LAB.zip --output MLU-LLMOPS-LAB.zip --location-trusted
unzip -o MLU-LLMOPS-LAB.zip && rm MLU-LLMOPS-LAB.zip

# Run this to set the correct system platform for your package 
if [ "$(uname -p)" == "x86_64" ]; then
	brazil ws use --platform AL2_x86_64
else
	brazil ws use --platform AL2_aarch64
fi

# Build the experiment package first (this step takes around 5 minutes):
cd $(brazil-context workspace root)/src/${Alias}MLUCourseLLMOpsExperiment
brazil-build 

# Then recursively build all other packages:
cd $(brazil-context workspace root)/src/${Alias}MLUCourseLLMOpsCDK
brazil-recursive-cmd brazil-build release
