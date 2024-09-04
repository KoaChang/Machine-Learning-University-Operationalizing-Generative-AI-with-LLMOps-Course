# Install Toolbox
/usr/bin/curl -fLSs -b ~/.midway/cookie 'https://buildertoolbox-bootstrap.s3-us-west-2.amazonaws.com/toolbox-install.sh' -o /tmp/toolbox-install.sh && /bin/bash /tmp/toolbox-install.sh
# Install mise 
/usr/bin/curl https://mise.run | sh
echo 'eval "$(~/.local/bin/mise activate zsh)"' >> ~/.zshrc
# Install Python@3.12 and awscurl
 ~/.local/bin/mise install python@3.12
 ~/.local/bin/mise exec python@3.12 -- pip install awscurl
# Install Nodejs@18
if [ "$(uname -p)" == "x86_64" ]; then
        ~/.local/bin/mise plugin install node ssh://git.amazon.com/pkg/RtxNode
fi
~/.local/bin/mise install node@18
# Install ada
toolbox install ada
# Install brazilcli
toolbox install brazilcli
# Install AWS CLI
if [ "$(uname)" == "Darwin" ]; then
        curl "https://awscli.amazonaws.com/AWSCLIV2.pkg" -o "AWSCLIV2.pkg"
        sudo installer -pkg AWSCLIV2.pkg -target /
elif [ "$(expr substr $(uname -s) 1 5)" == "Linux" ]; then
        if [[ $(uname -m) == 'aarch64' ]]; then
                curl "https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip" -o "awscliv2.zip"
        else
                curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
        fi
        unzip awscliv2.zip
        sudo ./aws/install
fi
