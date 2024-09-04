import boto3
import logging
import time

from datetime import datetime, timedelta

logger = logging.getLogger()
logger.setLevel(logging.INFO)

kendra = boto3.client("kendra")


def get_job_status(index_id: str, data_source_id: str, job_execution_id: str) -> dict:
    # We specify 3 hours as the time filter, which allows ~36k documents to be index. If you need to
    # index more documents, please increase the time delta.
    # Find out how much time does syncing a data source take:
    # https://docs.aws.amazon.com/kendra/latest/dg/troubleshooting-data-sources.html#troubleshooting-data-sources-sync-time
    time_filter = {
        "StartTime": datetime.now() - timedelta(hours=3),
        "EndTime": datetime.now(),
    }
    result = kendra.list_data_source_sync_jobs(
        Id=data_source_id,
        IndexId=index_id,
        StartTimeFilter=time_filter,
    )
    while True:
        for job in result.get("History"):
            if job["ExecutionId"] == job_execution_id:
                return job
        next_token = result.get("NextToken")
        if not next_token:
            break

        result = kendra.list_data_source_sync_jobs(
            Id=data_source_id,
            IndexId=index_id,
            NextToken=next_token,
            StartTimeFilter=time_filter,
        )

    raise Exception(f"Could not find sync job with execution ID {job_execution_id}")


def start_kendra_job_handler(event: dict, ctx: dict) -> dict:
    if event["RequestType"] == "Delete":
        return {}

    index_id = event["ResourceProperties"]["IndexId"]
    data_source_id = event["ResourceProperties"]["DataSourceId"]

    result = kendra.start_data_source_sync_job(Id=data_source_id, IndexId=index_id)

    logger.info(f"Start data source sync operation: {result}")
    job_execution_id = result["ExecutionId"]
    logger.info(f"Job execution ID {job_execution_id}")

    return {
        "Data": {
            "JobExecutionId": job_execution_id,
        },
    }


def wait_for_kendra_job_handler(event: dict, ctx: dict) -> dict:
    if event["RequestType"] == "Delete":
        return {}

    index_id = event["ResourceProperties"]["IndexId"]
    data_source_id = event["ResourceProperties"]["DataSourceId"]
    job_execution_id = event["ResourceProperties"]["JobExecutionId"]

    while job := get_job_status(index_id, data_source_id, job_execution_id):
        # Find all job status in AWS document:
        # https://docs.aws.amazon.com/kendra/latest/APIReference/API_DataSourceSyncJob.html#kendra-Type-DataSourceSyncJob-Status
        if job["Status"] not in ["SYNCING", "STOPPING", "SYNCING_INDEXING"]:
            logger.info(f"Job has finished. Current status is {job['Status']}")
            break
        logger.info(
            f"Job hasn't finished yet. Latest status is {job['Status']}. Sleeping."
        )
        time.sleep(15)

    if job["Status"] == "SUCCEEDED":
        return {}

    if job["Status"] == "FAILED":
        raise Exception(
            f"Data source sync job has failed with error message {job['ErrorMessage']}"
        )

    raise Exception(
        f"Data source sync job did not succeed, latest status was {job['Status']}"
    )
