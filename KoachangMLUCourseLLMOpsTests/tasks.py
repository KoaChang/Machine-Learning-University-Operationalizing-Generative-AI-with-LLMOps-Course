import os
import platform
import tempfile

from invoke import task

@task
def test(context):
    context.run("pip install -e .[tests]")
    context.run("pytest")


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
    context.run(f"{interpreter} -mpip install . --target {archive_dir.name} --platform manylinux2014_x86_64 --python-version 3.12 --only-binary=:all: --upgrade")
    context.run(f"find {archive_dir.name} -name '*.so' -o -name '__pycache__' -o -name '__pycache__' -o -name '*.pyc' -delete")

    output_location = os.path.abspath(
        os.path.join(context.cwd, "build", f"Lambda.zip")
    )
    context.run(f"rm -f {output_location}")

    with context.cd(archive_dir.name):
        context.run(f"zip -r {output_location} .")


@task(pre=[test, make_archive, copy_bats_publisher_configuration])
def release(context):
    pass
