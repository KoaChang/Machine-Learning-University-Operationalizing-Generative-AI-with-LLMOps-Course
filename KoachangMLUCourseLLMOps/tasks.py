import os
import platform
import tempfile

from invoke import task


PIPX_HOME=os.path.join(os.getcwd(), ".pipx", "local")
PIPX_ENV=os.path.join(PIPX_HOME, "venvs", "pipx")

@task
def pipx(context):
    if not os.path.exists(PIPX_HOME):
        os.makedirs(PIPX_HOME)
        context.run(f"python -m venv {PIPX_ENV}")
        context.run(f"{PIPX_ENV}/bin/pip install pipx")

@task
def test(context):
    context.run("pip install -e .[tests]")
    context.run("pytest")


@task(pipx)
def format(context):
    context.run(f"PIPX_HOME={PIPX_HOME} {PIPX_ENV}/bin/pipx install black")
    context.run(f"PIPX_HOME={PIPX_HOME} {PIPX_ENV}/bin/pipx install isort")
    context.run(f"{PIPX_HOME}/venvs/black/bin/black src")
    context.run(f"{PIPX_HOME}/venvs/isort/bin/isort src")


@task
def check(context):
    context.run(f"PIPX_HOME={PIPX_HOME} {PIPX_ENV}/bin/pipx install mypy")
    context.run(f"PIPX_HOME={PIPX_HOME} {PIPX_ENV}/bin/pipx install flake8")
    context.run(f"{PIPX_HOME}/venvs/mypy/bin/mypy")
    context.run(f"{PIPX_HOME}/venvs/flake8/bin/flake8 src")


@task
def copy_bats_publisher_configuration(context):
    """Copy the BATS publisher configuration to output directory.

    This function assumes that the configuration is located under configuration/Packaging
    of the package source.
    """
    context.run(f"cp -a configuration/Packaging build")


@task
def make_archive(context):
    """Create the Lambda zip file"""

    interpreter_version = ".".join(platform.python_version_tuple()[:2])
    interpreter = f"python{interpreter_version}"
    archive_dir = tempfile.TemporaryDirectory()
    context.run(f"{interpreter} -mpip install . --target {archive_dir.name} --platform manylinux2014_x86_64 --python-version 3.11 --only-binary=:all: --upgrade")
    context.run(f"find {archive_dir.name} -name '*.so' -o -name '__pycache__' -o -name '__pycache__' -o -name '*.pyc' -delete")

    output_location = os.path.abspath(
        os.path.join(context.cwd, "build", f"Lambda.zip")
    )
    context.run(f"rm -f {output_location}")

    with context.cd(archive_dir.name):
        context.run(f"zip -r {output_location} .")

@task(pre=[make_archive, copy_bats_publisher_configuration])
def compile(context):
    pass

@task(pre=[test, compile])
def release(context):
    pass
